/**
 * Revisão completa de sanidade dos dados — verifica se os números fazem sentido
 * de negócio e se as fontes estão consistentes.
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
  const supabase = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  const months = [
    { label: '2025-11', from: '2025-11-01', to: '2025-11-30' },
    { label: '2025-12', from: '2025-12-01', to: '2025-12-31' },
    { label: '2026-01', from: '2026-01-01', to: '2026-01-31' },
    { label: '2026-02', from: '2026-02-01', to: '2026-02-28' },
    { label: '2026-03', from: '2026-03-01', to: '2026-03-31' },
    { label: '2026-04', from: '2026-04-01', to: '2026-04-30' },
  ];

  // ========= 1. RESUMO POR MÊS COM MÉTRICAS DE NEGÓCIO =========
  console.log('========================================');
  console.log('1. RESUMO POR MÊS — métricas de negócio');
  console.log('========================================\n');

  for (const m of months) {
    // CA via view (SP timezone correct)
    const { data: caView } = await supabase
      .from('v_visao_geral_daily')
      .select('day, orders_count, gross_revenue')
      .eq('source', 'conta_azul')
      .gte('day', m.from)
      .lte('day', m.to);

    const { data: nsView } = await supabase
      .from('v_visao_geral_daily')
      .select('day, orders_count, gross_revenue')
      .eq('source', 'nuvemshop')
      .gte('day', m.from)
      .lte('day', m.to);

    const caRevenue = (caView ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
    const caOrders = (caView ?? []).reduce((s, r) => s + Number(r.orders_count), 0);
    const caDays = (caView ?? []).length;

    const nsRevenue = (nsView ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
    const nsOrders = (nsView ?? []).reduce((s, r) => s + Number(r.orders_count), 0);
    const nsDays = (nsView ?? []).length;

    const lojaRevenue = caRevenue - nsRevenue;
    const lojaOrders = caOrders - nsOrders;
    const totalRevenue = caRevenue; // = loja + site (fórmula Miranda)

    const avgTicketLoja = lojaOrders > 0 ? lojaRevenue / lojaOrders : 0;
    const avgTicketNs = nsOrders > 0 ? nsRevenue / nsOrders : 0;
    const avgTicketTotal = caOrders > 0 ? totalRevenue / caOrders : 0;

    console.log(`--- ${m.label} ---`);
    console.log(`  Total (= CA aprovado):  R$ ${fmt(totalRevenue).padStart(12)} | ${caOrders} pedidos | ticket R$ ${fmt(avgTicketTotal)} | ${caDays} dias CA`);
    console.log(`  Loja Física (CA - NS):  R$ ${fmt(lojaRevenue).padStart(12)} | ${lojaOrders} pedidos | ticket R$ ${fmt(avgTicketLoja)}`);
    console.log(`  Site (Nuvemshop):       R$ ${fmt(nsRevenue).padStart(12)} | ${nsOrders} pedidos | ticket R$ ${fmt(avgTicketNs)} | ${nsDays} dias NS`);
    console.log(`  Share loja:             ${totalRevenue > 0 ? ((lojaRevenue / totalRevenue) * 100).toFixed(1) : '0'}%`);
    console.log(`  Share site:             ${totalRevenue > 0 ? ((nsRevenue / totalRevenue) * 100).toFixed(1) : '0'}%`);

    // Sanity checks
    if (lojaRevenue < 0) console.log(`  ⚠️ LOJA FÍSICA NEGATIVA!`);
    if (lojaOrders < 0) console.log(`  ⚠️ PEDIDOS LOJA NEGATIVOS!`);
    if (avgTicketLoja > 2000) console.log(`  ⚠️ Ticket médio loja muito alto (> R$ 2.000)`);
    if (avgTicketNs > 1000) console.log(`  ⚠️ Ticket médio NS muito alto (> R$ 1.000)`);
    if (caDays < 15 && m.label !== '2026-04') console.log(`  ⚠️ Poucos dias com venda CA (${caDays})`);
    console.log('');
  }

  // ========= 2. CONSISTÊNCIA nstag vs NS real =========
  console.log('========================================');
  console.log('2. CONSISTÊNCIA nstag (CA) vs NS real');
  console.log('========================================');
  console.log('   nstag = vendas CA tagged "Nuvem Shop" (guardadas pra sum bater)');
  console.log('   NS real = ETL Nuvemshop direto da API NS');
  console.log('   diff = frete que NS inclui e CA não registra\n');

  console.log('month   | nstag (CA)    | NS real       | diff          | diff %');
  console.log('--------|---------------|---------------|---------------|-------');

  for (const m of months) {
    // nstag
    const nstag: Array<{ gross_revenue: number }> = [];
    let page = 0;
    while (true) {
      const { data } = await supabase
        .from('sales')
        .select('gross_revenue')
        .eq('source', 'conta_azul')
        .ilike('source_sale_id', 'nstag-%')
        .gte('sale_date', `${m.from}T03:00:00Z`)
        .lt('sale_date', `${m.to}T23:59:59Z`)
        .order('sale_id', { ascending: true })
        .range(page * 1000, (page + 1) * 1000 - 1);
      if (!data || data.length === 0) break;
      nstag.push(...(data as Array<{ gross_revenue: number }>));
      if (data.length < 1000) break;
      page++;
    }

    const { data: nsView } = await supabase
      .from('v_visao_geral_daily')
      .select('gross_revenue')
      .eq('source', 'nuvemshop')
      .gte('day', m.from)
      .lte('day', m.to);

    const nstagSum = nstag.reduce((s, r) => s + Number(r.gross_revenue), 0);
    const nsSum = (nsView ?? []).reduce((s, r) => s + Number(r.gross_revenue), 0);
    const diff = nsSum - nstagSum;
    const pct = nstagSum > 0 ? ((diff / nstagSum) * 100).toFixed(1) : '—';

    console.log(
      `${m.label} | R$ ${fmt(nstagSum).padStart(10)} | R$ ${fmt(nsSum).padStart(10)} | R$ ${fmt(diff).padStart(10)} | ${pct}%`,
    );
  }

  // ========= 3. TOP 10 VENDAS CA POR VALOR (outliers) =========
  console.log('\n========================================');
  console.log('3. TOP 10 vendas CA por valor (outliers)');
  console.log('========================================\n');

  const { data: topSales } = await supabase
    .from('sales')
    .select('source_sale_id, sale_date, gross_revenue, net_revenue, payment_method, customers(name)')
    .eq('source', 'conta_azul')
    .not('source_sale_id', 'ilike', 'nstag-%')
    .order('gross_revenue', { ascending: false })
    .limit(10);

  for (const r of topSales ?? []) {
    const cust = (r.customers as any)?.name ?? '—';
    console.log(
      `  ${String(r.sale_date).slice(0, 10)} | R$ ${fmt(Number(r.gross_revenue)).padStart(11)} | net R$ ${fmt(Number(r.net_revenue)).padStart(11)} | ${String(r.payment_method).padEnd(12)} | ${cust.slice(0, 30)}`,
    );
  }

  // ========= 4. JANEIRO 2026 — por que tão alto? =========
  console.log('\n========================================');
  console.log('4. JANEIRO 2026 — R$ 361K é anormal?');
  console.log('========================================\n');

  const { data: janDaily } = await supabase
    .from('v_visao_geral_daily')
    .select('day, source, orders_count, gross_revenue')
    .gte('day', '2026-01-01')
    .lte('day', '2026-01-31')
    .order('day', { ascending: true });

  const janCa = (janDaily ?? []).filter(r => r.source === 'conta_azul');
  const bigDays = janCa.filter(r => Number(r.gross_revenue) > 10000);
  console.log(`  CA dias com > R$ 10K: ${bigDays.length}`);
  for (const d of bigDays.slice(0, 10)) {
    console.log(`    ${d.day} | ${d.orders_count} pedidos | R$ ${fmt(Number(d.gross_revenue))}`);
  }

  // Top 5 vendas de janeiro
  const { data: janTop } = await supabase
    .from('sales')
    .select('source_sale_id, sale_date, gross_revenue, customers(name)')
    .eq('source', 'conta_azul')
    .not('source_sale_id', 'ilike', 'nstag-%')
    .gte('sale_date', '2026-01-01T03:00:00Z')
    .lt('sale_date', '2026-02-01T03:00:00Z')
    .order('gross_revenue', { ascending: false })
    .limit(5);

  console.log('\n  Top 5 vendas jan:');
  for (const r of janTop ?? []) {
    const cust = (r.customers as any)?.name ?? '—';
    console.log(`    ${String(r.sale_date).slice(0, 10)} | R$ ${fmt(Number(r.gross_revenue)).padStart(11)} | ${cust.slice(0, 40)}`);
  }

  // ========= 5. CONTAGEM TOTAL =========
  console.log('\n========================================');
  console.log('5. CONTAGEM TOTAL no Supabase');
  console.log('========================================\n');

  const { count: totalCa } = await supabase
    .from('sales').select('sale_id', { count: 'exact', head: true }).eq('source', 'conta_azul');
  const { count: totalNs } = await supabase
    .from('sales').select('sale_id', { count: 'exact', head: true }).eq('source', 'nuvemshop');
  const { count: totalNstag } = await supabase
    .from('sales').select('sale_id', { count: 'exact', head: true }).eq('source', 'conta_azul').ilike('source_sale_id', 'nstag-%');
  const { count: totalItems } = await supabase
    .from('sale_items').select('sale_id', { count: 'exact', head: true });
  const { count: totalCustomers } = await supabase
    .from('customers').select('customer_id', { count: 'exact', head: true });

  console.log(`  Sales CA (total):     ${totalCa}`);
  console.log(`  Sales CA (nstag):     ${totalNstag}`);
  console.log(`  Sales CA (loja):      ${(totalCa ?? 0) - (totalNstag ?? 0)}`);
  console.log(`  Sales NS:             ${totalNs}`);
  console.log(`  Sale items:           ${totalItems}`);
  console.log(`  Customers:            ${totalCustomers}`);
}

main().catch(console.error);
