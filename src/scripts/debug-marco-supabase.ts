/**
 * Diagnóstico SÓ-SUPABASE — Março 2026
 *
 * Analisa o que o ETL carregou no Supabase para março, sem tocar na API
 * do Conta Azul. Objetivo: identificar se o R$ 1.479,11 a mais vem de:
 *  - Duplicatas
 *  - Vendas com valor inflado (parcelas futuras somadas)
 *  - Fallback "receb-*" inflando o total
 *  - Itens fora do padrão (ex: sale com gross >> sum dos itens)
 *
 * Uso:
 *   npx tsx --env-file=.env.local src/scripts/debug-marco-supabase.ts
 */

import { createSupabaseAdmin } from '../lib/supabase.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('DEBUG MARÇO 2026 — Supabase only');
  console.log('========================================\n');

  const supabase = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  // 1. Sales CA em março (timezone: view usa at time zone 'America/Sao_Paulo')
  // Como o dashboard filtra: v_visao_geral_daily já aplica o tz.
  // Aqui replico pegando sale_date entre 2026-03-01T03:00Z e 2026-04-01T03:00Z
  // (São Paulo = UTC-3, então 00:00 SP = 03:00 UTC).
  const { data: salesMar, error: salesErr } = await supabase
    .from('sales')
    .select('sale_id, source_sale_id, sale_date, gross_revenue, net_revenue, status, customer_id, payment_method')
    .eq('source', 'conta_azul')
    .gte('sale_date', '2026-03-01T03:00:00Z')
    .lt('sale_date', '2026-04-01T03:00:00Z')
    .order('gross_revenue', { ascending: false })
    .limit(10000);

  if (salesErr) throw salesErr;
  const sales = salesMar ?? [];
  console.log(`📊 Sales (source=conta_azul, sale_date em março 2026):`);
  console.log(`   Linhas: ${sales.length}`);

  const totalGross = sales.reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0);
  const totalNet = sales.reduce((s, r) => s + Number(r.net_revenue ?? 0), 0);
  const byStatus = new Map<string, number>();
  for (const r of sales) {
    byStatus.set(r.status as string, (byStatus.get(r.status as string) ?? 0) + Number(r.gross_revenue));
  }

  console.log(`   Sum(gross_revenue): R$ ${fmt(totalGross)}`);
  console.log(`   Sum(net_revenue):   R$ ${fmt(totalNet)}`);
  console.log(`\n   Por status:`);
  for (const [s, v] of byStatus) console.log(`     ${s}: R$ ${fmt(v)}`);

  // 2. Via view v_visao_geral_daily
  const { data: viewRows } = await supabase
    .from('v_visao_geral_daily')
    .select('day, source, orders_count, gross_revenue')
    .eq('source', 'conta_azul')
    .gte('day', '2026-03-01')
    .lte('day', '2026-03-31')
    .order('day', { ascending: true });

  const viewTotal = (viewRows ?? []).reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0);
  const viewOrders = (viewRows ?? []).reduce((s, r) => s + Number(r.orders_count ?? 0), 0);
  console.log(`\n📈 Via v_visao_geral_daily (fonte que o frontend lê):`);
  console.log(`   Dias com venda: ${(viewRows ?? []).length}`);
  console.log(`   Pedidos: ${viewOrders}`);
  console.log(`   Sum(gross_revenue): R$ ${fmt(viewTotal)}`);

  // 3. Comparar com target
  const target = 82944.79;
  console.log(`\n🎯 Target Miranda: R$ ${fmt(target)}`);
  console.log(`   Diff gross: ${fmt(totalGross - target)} (${((totalGross / target - 1) * 100).toFixed(2)}%)`);

  // 4. Top 25 sales
  console.log('\n========================================');
  console.log('TOP 25 sales por gross_revenue');
  console.log('========================================');
  console.log('idx | sale_id | source_sale_id                          | sale_date  | gross        | net          | status | payment');
  const top = sales.slice(0, 25);
  for (let i = 0; i < top.length; i++) {
    const r = top[i]!;
    const saleId = String(r.sale_id).padStart(5);
    const srcId = String(r.source_sale_id).slice(0, 40).padEnd(40);
    const date = String(r.sale_date).slice(0, 10);
    const gross = fmt(Number(r.gross_revenue)).padStart(11);
    const net = fmt(Number(r.net_revenue)).padStart(11);
    const status = String(r.status).padEnd(6);
    const pmt = String(r.payment_method ?? '—').slice(0, 10).padEnd(10);
    console.log(`${String(i + 1).padStart(3)} | ${saleId} | ${srcId} | ${date} | R$ ${gross} | R$ ${net} | ${status} | ${pmt}`);
  }

  // 5. Detect "receb-*" fallback records
  const receb = sales.filter((r) => String(r.source_sale_id).startsWith('receb-'));
  const recebTotal = receb.reduce((s, r) => s + Number(r.gross_revenue), 0);
  console.log(`\n⚠ Sales criados via fallback createSaleFromRecebivel (source_sale_id "receb-*"):`);
  console.log(`   ${receb.length} linhas | Sum(gross): R$ ${fmt(recebTotal)}`);
  if (receb.length > 0 && receb.length <= 10) {
    for (const r of receb) {
      console.log(`     ${String(r.source_sale_id).padEnd(20)} | ${String(r.sale_date).slice(0, 10)} | R$ ${fmt(Number(r.gross_revenue)).padStart(11)}`);
    }
  }

  // 6. Sales com gross > net (quando deveria ser <= na prática: valor_bruto = subtotal)
  // NOTA: no código sync.ts, gross = sum(pago) do recebível e net = valor_bruto do detalhe.
  // Se gross > net, a venda provavelmente está com PARCELAS de outros meses somadas em pago.
  const grossMoreThanNet = sales.filter((r) => {
    const g = Number(r.gross_revenue);
    const n = Number(r.net_revenue);
    return g > n + 0.5;
  });
  const grossOver = grossMoreThanNet.reduce((s, r) => s + (Number(r.gross_revenue) - Number(r.net_revenue)), 0);
  console.log(`\n⚠ Sales com gross > net (indício de parcelas futuras somadas):`);
  console.log(`   ${grossMoreThanNet.length} linhas | excedente total: R$ ${fmt(grossOver)}`);
  if (grossMoreThanNet.length > 0) {
    console.log('   Top 15:');
    const top15 = grossMoreThanNet
      .slice()
      .sort((a, b) => (Number(b.gross_revenue) - Number(b.net_revenue)) - (Number(a.gross_revenue) - Number(a.net_revenue)))
      .slice(0, 15);
    for (const r of top15) {
      const g = Number(r.gross_revenue);
      const n = Number(r.net_revenue);
      console.log(`     ${String(r.source_sale_id).slice(0, 40).padEnd(40)} | ${String(r.sale_date).slice(0, 10)} | gross R$ ${fmt(g).padStart(11)} | net R$ ${fmt(n).padStart(11)} | diff +${fmt(g - n)}`);
    }
  }

  // 7. Breakdown por dia em março
  console.log('\n========================================');
  console.log('BREAKDOWN POR DIA (via v_visao_geral_daily)');
  console.log('========================================');
  for (const row of viewRows ?? []) {
    console.log(`  ${row.day}  ${String(row.orders_count).padStart(3)} pedidos  R$ ${fmt(Number(row.gross_revenue)).padStart(11)}`);
  }

  // 8. Sale items agregados para março (deveria bater com net_revenue somado)
  const { data: items } = await supabase
    .from('sale_items')
    .select('quantity, total_price, sales!inner(source, sale_date, status)')
    .eq('sales.source', 'conta_azul')
    .eq('sales.status', 'paid')
    .gte('sales.sale_date', '2026-03-01T03:00:00Z')
    .lt('sales.sale_date', '2026-04-01T03:00:00Z')
    .limit(10000);

  const itemsTotal = (items ?? []).reduce((s, r) => s + Number(r.total_price ?? 0), 0);
  console.log(`\n🛒 sale_items de março (source=conta_azul, status=paid):`);
  console.log(`   Itens: ${(items ?? []).length}`);
  console.log(`   Sum(total_price): R$ ${fmt(itemsTotal)}`);

  // 9. Net vs items divergência
  console.log('\n========================================');
  console.log('RECONCILIAÇÃO FINAL');
  console.log('========================================');
  console.log(`  Miranda fechamento:        R$ ${fmt(target)}`);
  console.log(`  Dashboard (gross, view):   R$ ${fmt(viewTotal)}`);
  console.log(`  Sum gross (direto sales):  R$ ${fmt(totalGross)}`);
  console.log(`  Sum net  (direto sales):   R$ ${fmt(totalNet)}`);
  console.log(`  Sum sale_items total:      R$ ${fmt(itemsTotal)}`);
  console.log('');
  console.log(`  Gross vs Miranda:          ${totalGross >= target ? '+' : ''}${fmt(totalGross - target)}`);
  console.log(`  Net vs Miranda:            ${totalNet >= target ? '+' : ''}${fmt(totalNet - target)}`);
  console.log(`  sale_items vs Miranda:     ${itemsTotal >= target ? '+' : ''}${fmt(itemsTotal - target)}`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
