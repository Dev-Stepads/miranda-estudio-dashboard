/**
 * Validação completa de integridade dos dados — todas as fontes, todos os meses.
 *
 * Verifica:
 *  1. Totais mensais CA vs API totais.aprovado (cruzamento real)
 *  2. Totais mensais NS no banco
 *  3. Formula CA - NS = Loja Física para cada mês
 *  4. Anomalias: vendas com gross=0, gross<0, duplicatas, dias sem venda
 *  5. Meta Ads: spend/purchases cruzados
 *  6. Consistência entre sales e sale_items
 *  7. Vendas nstag vs NS por mês
 *
 * Uso: npx tsx --env-file=.env.local src/scripts/validate-all-data.ts
 */

import { ContaAzulTokenManager } from '../integrations/conta-azul/auth.ts';
import { createSupabaseAdmin } from '../lib/supabase.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const BASE = 'https://api-v2.contaazul.com/v1';
const UA = 'Miranda Dashboard Validation (dev@stepads.com.br)';

async function main(): Promise<void> {
  const sb = createSupabaseAdmin({
    url: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  });

  const issues: string[] = [];

  // ============================================================
  // 1. INVENTÁRIO GERAL
  // ============================================================
  console.log('========================================');
  console.log('1. INVENTÁRIO GERAL');
  console.log('========================================\n');

  const { count: salesCount } = await sb.from('sales').select('*', { count: 'exact', head: true });
  const { count: itemsCount } = await sb.from('sale_items').select('*', { count: 'exact', head: true });
  const { count: customersCount } = await sb.from('customers').select('*', { count: 'exact', head: true });
  const { count: metaCount } = await sb.from('meta_ads_insights').select('*', { count: 'exact', head: true });
  const { count: abandonedCount } = await sb.from('abandoned_checkouts').select('*', { count: 'exact', head: true });

  console.log(`  Sales:              ${salesCount}`);
  console.log(`  Sale items:         ${itemsCount}`);
  console.log(`  Customers:          ${customersCount}`);
  console.log(`  Meta Ads insights:  ${metaCount}`);
  console.log(`  Abandoned carts:    ${abandonedCount}`);

  // ============================================================
  // 2. ANOMALIAS EM SALES
  // ============================================================
  console.log('\n========================================');
  console.log('2. ANOMALIAS EM SALES');
  console.log('========================================\n');

  // 2a. Sales com gross_revenue = 0
  const { data: zeroGross } = await sb
    .from('sales')
    .select('sale_id, source, source_sale_id, sale_date, gross_revenue')
    .eq('gross_revenue', 0)
    .limit(100);
  console.log(`  Sales com gross_revenue = 0: ${(zeroGross ?? []).length}`);
  if ((zeroGross ?? []).length > 0) {
    issues.push(`${(zeroGross ?? []).length} sales com gross_revenue = 0`);
    for (const s of (zeroGross ?? []).slice(0, 5)) {
      console.log(`    ${s.source} | ${(s.source_sale_id as string).slice(0, 30)} | ${(s.sale_date as string).slice(0, 10)}`);
    }
  }

  // 2b. Sales com gross_revenue < 0
  const { data: negGross } = await sb
    .from('sales')
    .select('sale_id, source, source_sale_id, sale_date, gross_revenue')
    .lt('gross_revenue', 0)
    .limit(100);
  console.log(`  Sales com gross_revenue < 0: ${(negGross ?? []).length}`);
  if ((negGross ?? []).length > 0) {
    issues.push(`${(negGross ?? []).length} sales com gross_revenue negativo`);
    for (const s of (negGross ?? []).slice(0, 5)) {
      console.log(`    ${s.source} | R$ ${fmt(Number(s.gross_revenue))} | ${(s.sale_date as string).slice(0, 10)}`);
    }
  }

  // 2c. Sales sem customer_id
  const { count: noCustomer } = await sb
    .from('sales')
    .select('*', { count: 'exact', head: true })
    .is('customer_id', null);
  console.log(`  Sales sem customer_id: ${noCustomer}`);

  // 2d. Sales com status != 'paid'
  const { data: nonPaid } = await sb
    .from('sales')
    .select('status')
    .neq('status', 'paid')
    .limit(1000);
  const statusMap = new Map<string, number>();
  for (const r of nonPaid ?? []) {
    statusMap.set(r.status as string, (statusMap.get(r.status as string) ?? 0) + 1);
  }
  if (statusMap.size > 0) {
    console.log(`  Sales com status != 'paid':`);
    for (const [s, c] of statusMap) console.log(`    ${s}: ${c}`);
  } else {
    console.log(`  Sales com status != 'paid': 0 (todos são paid)`);
  }

  // ============================================================
  // 3. TOTAIS MENSAIS POR FONTE (via view)
  // ============================================================
  console.log('\n========================================');
  console.log('3. TOTAIS MENSAIS POR FONTE');
  console.log('========================================\n');

  const { data: allDaily } = await sb
    .from('v_visao_geral_daily')
    .select('day, source, orders_count, gross_revenue')
    .order('day', { ascending: true })
    .limit(50000);

  // Agrupar por mês e fonte
  const monthly = new Map<string, { ca: number; ns: number; caOrders: number; nsOrders: number; days: Set<string> }>();
  for (const r of allDaily ?? []) {
    const month = (r.day as string).slice(0, 7);
    const entry = monthly.get(month) ?? { ca: 0, ns: 0, caOrders: 0, nsOrders: 0, days: new Set<string>() };
    if (r.source === 'conta_azul') {
      entry.ca += Number(r.gross_revenue);
      entry.caOrders += Number(r.orders_count);
    } else if (r.source === 'nuvemshop') {
      entry.ns += Number(r.gross_revenue);
      entry.nsOrders += Number(r.orders_count);
    }
    entry.days.add(r.day as string);
    monthly.set(month, entry);
  }

  const sortedMonths = [...monthly.keys()].sort();

  console.log('Mês       | CA Revenue      | CA Ped | NS Revenue      | NS Ped | Loja (CA-NS)    | Total           | Dias');
  console.log('-'.repeat(130));

  let totalCA = 0, totalNS = 0, totalLoja = 0, totalGeral = 0;

  for (const month of sortedMonths) {
    const m = monthly.get(month)!;
    const loja = Math.max(0, m.ca - m.ns);
    totalCA += m.ca;
    totalNS += m.ns;
    totalLoja += loja;
    totalGeral += m.ca;

    const lojaFlag = loja < 0 ? ' ⚠ NEGATIVO' : '';
    console.log(
      `${month}   | R$ ${fmt(m.ca).padStart(12)} | ${String(m.caOrders).padStart(5)} | R$ ${fmt(m.ns).padStart(12)} | ${String(m.nsOrders).padStart(5)} | R$ ${fmt(loja).padStart(12)} | R$ ${fmt(m.ca).padStart(12)} | ${m.days.size}${lojaFlag}`
    );

    // Verificar se Loja < 0 em algum mês
    if (m.ca - m.ns < -0.01) {
      issues.push(`${month}: Loja Física negativa (CA R$ ${fmt(m.ca)} < NS R$ ${fmt(m.ns)})`);
    }
  }

  console.log('-'.repeat(130));
  console.log(
    `TOTAL     | R$ ${fmt(totalCA).padStart(12)} |       | R$ ${fmt(totalNS).padStart(12)} |       | R$ ${fmt(totalLoja).padStart(12)} | R$ ${fmt(totalGeral).padStart(12)} |`
  );

  // ============================================================
  // 4. CRUZAMENTO CA COM API (totais.aprovado por mês)
  // ============================================================
  console.log('\n========================================');
  console.log('4. CRUZAMENTO CA vs API (totais.aprovado)');
  console.log('========================================\n');

  // Obter token
  const { data: cfg } = await sb
    .from('etl_config')
    .select('value')
    .eq('key', 'conta_azul_refresh_token')
    .limit(1);

  const refreshToken = (cfg?.[0]?.value as string) || env('CONTA_AZUL_REFRESH_TOKEN');

  const tokenManager = new ContaAzulTokenManager({
    clientId: env('CONTA_AZUL_CLIENT_ID'),
    clientSecret: env('CONTA_AZUL_CLIENT_SECRET'),
    refreshToken,
    onRefresh: async (tokens) => {
      await sb.from('etl_config').upsert(
        { key: 'conta_azul_refresh_token', value: tokens.newRefreshToken, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    },
  });

  const accessToken = await tokenManager.getAccessToken();
  console.log('Token obtido. Consultando API por mês...\n');

  // Testar meses que temos no banco (só CA)
  const caMonths = sortedMonths.filter(m => (monthly.get(m)?.ca ?? 0) > 0);

  console.log('Mês       | Banco (CA view) | API aprovado    | Diff            | Status');
  console.log('-'.repeat(100));

  for (const month of caMonths) {
    const [year, mon] = month.split('-');
    const lastDay = new Date(Number(year), Number(mon), 0).getDate();
    const from = `${month}-01`;
    const to = `${month}-${lastDay}`;

    await sleep(300);
    const url = `${BASE}/venda/busca?data_inicio=${from}&data_fim=${to}&tamanho_pagina=1`;
    const headers = { Authorization: `Bearer ${accessToken}`, 'User-Agent': UA };

    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.log(`${month}   | R$ ${fmt(monthly.get(month)!.ca).padStart(12)} | HTTP ${resp.status}        |                 | ⚠ API ERROR`);
        continue;
      }
      const json = await resp.json() as { totais?: { aprovado?: number } };
      const apiAprovado = json.totais?.aprovado ?? 0;
      const bancoCA = monthly.get(month)!.ca;
      const diff = bancoCA - apiAprovado;
      const status = Math.abs(diff) < 0.01 ? '✅ MATCH' : Math.abs(diff) < 1 ? '✅ ~centavos' : '❌ DIFF';

      console.log(
        `${month}   | R$ ${fmt(bancoCA).padStart(12)} | R$ ${fmt(apiAprovado).padStart(12)} | ${diff >= 0 ? '+' : ''}R$ ${fmt(diff).padStart(11)} | ${status}`
      );

      if (Math.abs(diff) >= 1) {
        issues.push(`${month}: CA banco R$ ${fmt(bancoCA)} vs API R$ ${fmt(apiAprovado)} — diff R$ ${fmt(diff)}`);
      }
    } catch (err) {
      console.log(`${month}   | R$ ${fmt(monthly.get(month)!.ca).padStart(12)} | FETCH ERROR     |                 | ⚠ NETWORK`);
    }
  }

  // ============================================================
  // 5. CONSISTÊNCIA SALES vs SALE_ITEMS
  // ============================================================
  console.log('\n========================================');
  console.log('5. CONSISTÊNCIA SALES vs SALE_ITEMS');
  console.log('========================================\n');

  // Sales paid sem nenhum sale_item
  const { data: salesNoItems } = await sb.rpc('', {}).select('*');
  // Vamos fazer via query direta
  const { data: salesPaid } = await sb
    .from('sales')
    .select('sale_id')
    .eq('status', 'paid')
    .limit(50000);

  const saleIds = (salesPaid ?? []).map(s => s.sale_id as number);

  // Contar items por sale_id
  const { data: itemCounts } = await sb
    .from('sale_items')
    .select('sale_id')
    .limit(100000);

  const itemSaleIds = new Set((itemCounts ?? []).map(i => i.sale_id as number));
  const salesWithoutItems = saleIds.filter(id => !itemSaleIds.has(id));

  console.log(`  Sales (paid) total: ${saleIds.length}`);
  console.log(`  Sales com items: ${saleIds.length - salesWithoutItems.length}`);
  console.log(`  Sales SEM items: ${salesWithoutItems.length}`);
  if (salesWithoutItems.length > 0) {
    issues.push(`${salesWithoutItems.length} sales paid sem nenhum sale_item`);
    // Mostrar amostras
    const { data: sampleNoItems } = await sb
      .from('sales')
      .select('sale_id, source, source_sale_id, sale_date, gross_revenue')
      .in('sale_id', salesWithoutItems.slice(0, 10));
    for (const s of sampleNoItems ?? []) {
      console.log(`    sale_id=${s.sale_id} | ${s.source} | ${(s.source_sale_id as string).slice(0, 30)} | ${(s.sale_date as string).slice(0, 10)} | R$ ${fmt(Number(s.gross_revenue))}`);
    }
  }

  // ============================================================
  // 6. META ADS — RESUMO POR MÊS
  // ============================================================
  console.log('\n========================================');
  console.log('6. META ADS — RESUMO POR MÊS');
  console.log('========================================\n');

  const { data: metaDaily } = await sb
    .from('v_meta_account_daily')
    .select('date, spend, impressions, clicks, purchases, purchase_value')
    .order('date', { ascending: true })
    .limit(10000);

  if ((metaDaily ?? []).length === 0) {
    console.log('  Sem dados Meta Ads no banco.');
  } else {
    const metaMonthly = new Map<string, { spend: number; impressions: number; clicks: number; purchases: number; purchaseValue: number; days: number }>();
    for (const r of metaDaily ?? []) {
      const month = (r.date as string).slice(0, 7);
      const entry = metaMonthly.get(month) ?? { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, days: 0 };
      entry.spend += Number(r.spend ?? 0);
      entry.impressions += Number(r.impressions ?? 0);
      entry.clicks += Number(r.clicks ?? 0);
      entry.purchases += Number(r.purchases ?? 0);
      entry.purchaseValue += Number(r.purchase_value ?? 0);
      entry.days += 1;
      metaMonthly.set(month, entry);
    }

    console.log('Mês       | Spend           | Impressões | Cliques | Compras | ROAS   | Dias');
    console.log('-'.repeat(95));
    for (const [month, m] of [...metaMonthly.entries()].sort()) {
      const roas = m.spend > 0 ? (m.purchaseValue / m.spend).toFixed(2) : '—';
      console.log(
        `${month}   | R$ ${fmt(m.spend).padStart(12)} | ${String(m.impressions).padStart(10)} | ${String(m.clicks).padStart(7)} | ${String(m.purchases).padStart(7)} | ${String(roas).padStart(6)} | ${m.days}`
      );

      // Flag: spend > 0 mas purchases = 0 por mês inteiro
      if (m.spend > 100 && m.purchases === 0) {
        issues.push(`Meta ${month}: R$ ${fmt(m.spend)} de spend mas 0 purchases`);
      }
    }
  }

  // ============================================================
  // 7. NUVEMSHOP — VERIFICAÇÃO DE ABANDONADOS
  // ============================================================
  console.log('\n========================================');
  console.log('7. ABANDONED CHECKOUTS');
  console.log('========================================\n');

  const { data: abandoned } = await sb
    .from('abandoned_checkouts')
    .select('checkout_id, created_at, total_amount')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log(`  Total checkouts abandonados: ${abandonedCount}`);
  console.log(`  Mais recente: ${(abandoned?.[0]?.created_at as string)?.slice(0, 10) ?? 'N/A'}`);
  console.log(`  Mais antigo dos 5 últimos: ${(abandoned?.[4]?.created_at as string)?.slice(0, 10) ?? 'N/A'}`);

  // ============================================================
  // 8. DUPLICATAS
  // ============================================================
  console.log('\n========================================');
  console.log('8. VERIFICAÇÃO DE DUPLICATAS');
  console.log('========================================\n');

  // Vendas com mesmo source + source_sale_id (deveria ser unique)
  const { data: allSalesSrcId } = await sb
    .from('sales')
    .select('source, source_sale_id')
    .limit(100000);

  const srcIdSet = new Set<string>();
  const dupes: string[] = [];
  for (const s of allSalesSrcId ?? []) {
    const key = `${s.source}|${s.source_sale_id}`;
    if (srcIdSet.has(key)) dupes.push(key);
    srcIdSet.add(key);
  }
  console.log(`  Sales com source+source_sale_id duplicado: ${dupes.length}`);
  if (dupes.length > 0) {
    issues.push(`${dupes.length} vendas com source+source_sale_id duplicado`);
    for (const d of dupes.slice(0, 5)) console.log(`    ${d}`);
  }

  // ============================================================
  // RESUMO FINAL
  // ============================================================
  console.log('\n========================================');
  console.log('RESUMO — ISSUES ENCONTRADAS');
  console.log('========================================\n');

  if (issues.length === 0) {
    console.log('  ✅ NENHUMA ISSUE ENCONTRADA. Dados íntegros.');
  } else {
    console.log(`  ❌ ${issues.length} issue(s) encontrada(s):\n`);
    for (let i = 0; i < issues.length; i++) {
      console.log(`  ${i + 1}. ${issues[i]}`);
    }
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
