/**
 * T49 — Verificação completa do gap de Março 2026
 * Simula exatamente o cálculo que o dashboard faz.
 *
 * Uso: npx tsx --env-file=.env.local src/scripts/verify-t49.ts
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
  const sb = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  // 1. v_visao_geral_daily para março (exatamente o que o frontend lê)
  const { data: daily } = await sb
    .from('v_visao_geral_daily')
    .select('day, source, orders_count, gross_revenue')
    .gte('day', '2026-03-01')
    .lte('day', '2026-03-31')
    .limit(10000);

  const caRows = (daily ?? []).filter(r => r.source === 'conta_azul');
  const nsRows = (daily ?? []).filter(r => r.source === 'nuvemshop');

  const caRevenue = caRows.reduce((s, r) => s + Number(r.gross_revenue), 0);
  const nsRevenue = nsRows.reduce((s, r) => s + Number(r.gross_revenue), 0);
  const caOrders = caRows.reduce((s, r) => s + Number(r.orders_count), 0);
  const nsOrders = nsRows.reduce((s, r) => s + Number(r.orders_count), 0);

  const lojaRevenue = Math.max(0, caRevenue - nsRevenue);
  const totalRevenue = caRevenue;

  console.log('========================================');
  console.log('SIMULAÇÃO DO DASHBOARD — Março 2026');
  console.log('========================================\n');
  console.log('v_visao_geral_daily:');
  console.log(`  CA (source=conta_azul):  R$ ${fmt(caRevenue)} | ${caOrders} pedidos`);
  console.log(`  NS (source=nuvemshop):   R$ ${fmt(nsRevenue)} | ${nsOrders} pedidos`);
  console.log('\nFormula do dashboard:');
  console.log(`  Total Revenue = CA       = R$ ${fmt(totalRevenue)}`);
  console.log(`  E-commerce    = NS       = R$ ${fmt(nsRevenue)}`);
  console.log(`  Loja Física   = CA - NS  = R$ ${fmt(lojaRevenue)}`);

  console.log('\nTarget Miranda:');
  console.log('  Loja Física:   R$ 82.944,79');
  console.log('  E-commerce:    R$ 33.599,21');
  console.log('  Total:         R$ 116.544,00');

  const diffLoja = lojaRevenue - 82944.79;
  const diffNS = nsRevenue - 33599.21;
  const diffTotal = totalRevenue - 116544.00;

  console.log('\nDiffs:');
  console.log(`  Loja:  ${diffLoja >= 0 ? '+' : ''}R$ ${fmt(diffLoja)} ${Math.abs(diffLoja) < 0.01 ? '✅ MATCH EXATO' : Math.abs(diffLoja) < 1 ? '✅ MATCH (~centavos)' : '❌ DIFF'}`);
  console.log(`  NS:    ${diffNS >= 0 ? '+' : ''}R$ ${fmt(diffNS)} ${Math.abs(diffNS) < 0.01 ? '✅ MATCH EXATO' : Math.abs(diffNS) < 1 ? '✅ MATCH (~centavos)' : '❌ DIFF'}`);
  console.log(`  Total: ${diffTotal >= 0 ? '+' : ''}R$ ${fmt(diffTotal)} ${Math.abs(diffTotal) < 0.01 ? '✅ MATCH EXATO' : Math.abs(diffTotal) < 1 ? '✅ MATCH (~centavos)' : '❌ DIFF'}`);

  // 2. Vendas nstag (NS dentro do CA)
  const { data: nstagSales } = await sb
    .from('sales')
    .select('gross_revenue')
    .eq('source', 'conta_azul')
    .like('source_sale_id', 'nstag-%')
    .gte('sale_date', '2026-03-01T03:00:00Z')
    .lt('sale_date', '2026-04-01T03:00:00Z')
    .limit(10000);

  const nstagRevenue = (nstagSales ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
  const nstagCount = (nstagSales ?? []).length;

  console.log('\n========================================');
  console.log('VERIFICAÇÃO CRUZADA');
  console.log('========================================\n');
  console.log(`Vendas nstag- (NS tagadas dentro do CA):`);
  console.log(`  Count: ${nstagCount}`);
  console.log(`  Sum gross: R$ ${fmt(nstagRevenue)}`);
  console.log(`  NS direto: R$ ${fmt(nsRevenue)}`);
  console.log(`  Diff nstag vs NS: R$ ${fmt(nstagRevenue - nsRevenue)}`);

  // 3. Vendas CA sem nstag (loja pura)
  const { data: lojaPuraSales } = await sb
    .from('sales')
    .select('gross_revenue')
    .eq('source', 'conta_azul')
    .not('source_sale_id', 'like', 'nstag-%')
    .gte('sale_date', '2026-03-01T03:00:00Z')
    .lt('sale_date', '2026-04-01T03:00:00Z')
    .eq('status', 'paid')
    .limit(10000);

  const lojaPuraRevenue = (lojaPuraSales ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
  const lojaPuraCount = (lojaPuraSales ?? []).length;

  console.log(`\nVendas CA sem nstag (loja pura):`);
  console.log(`  Count: ${lojaPuraCount}`);
  console.log(`  Sum gross: R$ ${fmt(lojaPuraRevenue)}`);

  console.log('\n========================================');
  console.log('RESUMO FINAL');
  console.log('========================================\n');
  console.log(`  CA total (view):            R$ ${fmt(caRevenue)}`);
  console.log(`  nstag (NS no CA):           R$ ${fmt(nstagRevenue)}`);
  console.log(`  Loja pura (CA sem nstag):   R$ ${fmt(lojaPuraRevenue)}`);
  console.log(`  NS (fonte nuvemshop):       R$ ${fmt(nsRevenue)}`);
  console.log('');
  console.log(`  Dashboard Loja = CA - NS:   R$ ${fmt(caRevenue - nsRevenue)}`);
  console.log(`  Miranda Loja:               R$ 82.944,79`);
  console.log(`  Diff:                       R$ ${fmt(caRevenue - nsRevenue - 82944.79)}`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
