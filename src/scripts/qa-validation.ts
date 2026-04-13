/**
 * QA Validation Script — cruza dados do dashboard contra APIs reais.
 * Usage: npx tsx --env-file=.env.local src/scripts/qa-validation.ts
 */

import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log('========================================');
  console.log('QA — VALIDAÇÃO CRUZADA DO DASHBOARD');
  console.log('========================================\n');

  // ============================================
  // 1. META ADS
  // ============================================
  console.log('=== 1. META ADS ===');
  const token = process.env.META_SYSTEM_USER_TOKEN!;
  const accountId = process.env.META_AD_ACCOUNT_ID!;

  // API: explicit date range matching what we query from DB
  // (last_30d preset excludes today — use explicit time_range for exact match)
  const now = new Date();
  const ago30 = new Date(now.getTime() - 30 * 86400000);
  const yesterday = new Date(now.getTime() - 86400000);
  const apiSince = ago30.toISOString().split('T')[0]!;
  const apiUntil = yesterday.toISOString().split('T')[0]!;
  const url30 = `https://graph.facebook.com/v25.0/${accountId}/insights?fields=spend,impressions,clicks,reach,actions,action_values&time_range={"since":"${apiSince}","until":"${apiUntil}"}&access_token=${token}`;
  const res30 = await fetch(url30);
  const d30 = await res30.json() as { data?: Array<Record<string, unknown>> };
  const api30 = d30.data?.[0] as Record<string, unknown> | undefined;

  const apiSpend = +(api30?.spend as string || '0');
  const apiImpr = +(api30?.impressions as string || '0');
  const apiClicks = +(api30?.clicks as string || '0');
  const actions = (api30?.actions || []) as Array<{ action_type: string; value: string }>;
  const actionVals = (api30?.action_values || []) as Array<{ action_type: string; value: string }>;
  const apiPurch = +(actions.find(a => a.action_type === 'purchase')?.value || '0');
  const apiPV = +(actionVals.find(a => a.action_type === 'purchase')?.value || '0');

  // Supabase: last 30d
  const since30 = new Date();
  since30.setDate(since30.getDate() - 30);
  const since30Str = since30.toISOString().split('T')[0]!;
  const { data: metaDaily } = await sb.from('v_meta_account_daily').select('*').gte('date', since30Str).limit(10000);
  let dbSpend = 0, dbImpr = 0, dbClicks = 0, dbPurch = 0, dbPV = 0;
  for (const r of metaDaily || []) {
    dbSpend += +r.spend; dbImpr += +r.impressions; dbClicks += +r.clicks;
    dbPurch += +r.purchases; dbPV += +r.purchase_value;
  }

  const check = (label: string, api: number, db: number, tol = 1) => {
    const ok = Math.abs(api - db) <= tol;
    console.log(`  ${label}: API=${api}  DB=${db}  ${ok ? '✅' : '❌ DIFF=' + (db - api).toFixed(2)}`);
    return ok;
  };

  // Match the exact same range in DB (exclude today to match API)
  const { data: metaDailyExact } = await sb.from('v_meta_account_daily').select('*').gte('date', apiSince).lte('date', apiUntil).limit(10000);
  dbSpend = 0; dbImpr = 0; dbClicks = 0; dbPurch = 0; dbPV = 0;
  for (const r of metaDailyExact || []) {
    dbSpend += +r.spend; dbImpr += +r.impressions; dbClicks += +r.clicks;
    dbPurch += +r.purchases; dbPV += +r.purchase_value;
  }
  console.log(`Period: ${apiSince} → ${apiUntil} (exact match API vs DB)`);
  check('spend', apiSpend, dbSpend, 2);
  check('impressions', apiImpr, dbImpr, 0);
  check('clicks', apiClicks, dbClicks, 0);
  check('purchases', apiPurch, dbPurch, 0);
  check('purchase_val', apiPV, dbPV, 1);

  // ============================================
  // 2. NUVEMSHOP
  // ============================================
  console.log('\n=== 2. NUVEMSHOP ===');
  const nsToken = process.env.NUVEMSHOP_ACCESS_TOKEN!;
  const nsStoreId = process.env.NUVEMSHOP_STORE_ID!;
  const nsUA = process.env.NUVEMSHOP_USER_AGENT!;

  const nsHeaders = {
    Authentication: `bearer ${nsToken}`,
    'User-Agent': nsUA,
    'Content-Type': 'application/json',
  };

  // Total order count
  const nsCountRes = await fetch(
    `https://api.nuvemshop.com.br/v1/${nsStoreId}/orders?per_page=1&page=1&fields=id`,
    { headers: nsHeaders },
  );
  const nsTotal = nsCountRes.headers.get('x-total-count') || '?';

  const { count: dbNsCount } = await sb.from('sales').select('*', { count: 'exact', head: true }).eq('source', 'nuvemshop');
  console.log(`  Total orders: API=${nsTotal}  DB=${dbNsCount}  ${String(dbNsCount) === nsTotal ? '✅' : '❌ DIFF'}`);

  // Spot check: 3 most recent paid orders
  const nsRecentRes = await fetch(
    `https://api.nuvemshop.com.br/v1/${nsStoreId}/orders?per_page=3&fields=id,total,financial_status,created_at&status=any`,
    { headers: nsHeaders },
  );
  const nsRecentRaw = await nsRecentRes.json();
  const nsRecent = (Array.isArray(nsRecentRaw) ? nsRecentRaw : []) as Array<{ id: number; total: string; financial_status: string }>;

  console.log('  Spot check (3 recent orders):');
  for (const o of nsRecent) {
    const { data: dbOrder } = await sb
      .from('sales')
      .select('gross_revenue, status')
      .eq('source', 'nuvemshop')
      .eq('source_sale_id', String(o.id))
      .limit(1);
    const dbR = dbOrder?.[0];
    const apiTotal = +(o.total || 0);
    if (dbR) {
      const match = Math.abs(apiTotal - +dbR.gross_revenue) < 0.01;
      console.log(`    #${o.id} API=R$${apiTotal.toFixed(2)} (${o.financial_status})  DB=R$${(+dbR.gross_revenue).toFixed(2)} (${dbR.status})  ${match ? '✅' : '❌ DIFF'}`);
    } else {
      console.log(`    #${o.id} API=R$${apiTotal.toFixed(2)} (${o.financial_status})  ❌ NOT IN DB`);
    }
  }

  // ============================================
  // 3. CONTA AZUL
  // ============================================
  console.log('\n=== 3. CONTA AZUL ===');
  const { count: dbCaCount } = await sb.from('sales').select('*', { count: 'exact', head: true }).eq('source', 'conta_azul');
  const { count: dbCaItems } = await sb.from('sale_items').select('*', { count: 'exact', head: true });
  console.log(`  Sales in DB: ${dbCaCount}`);
  console.log(`  Total sale_items (all sources): ${dbCaItems}`);
  console.log('  (Conta Azul API requires OAuth flow — cannot spot-check here)');

  // ============================================
  // 4. VISÃO GERAL CONSISTENCY
  // ============================================
  console.log('\n=== 4. VISÃO GERAL (cross-source) ===');

  // View revenue
  const allVgRows: Array<{ source: string; gross_revenue: number }> = [];
  let page = 0;
  while (true) {
    const { data } = await sb.from('v_visao_geral_daily').select('source, gross_revenue').range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allVgRows.push(...(data as typeof allVgRows));
    if (data.length < 1000) break;
    page++;
  }

  let vgNS = 0, vgCA = 0;
  for (const r of allVgRows) {
    if (r.source === 'nuvemshop') vgNS += +r.gross_revenue;
    if (r.source === 'conta_azul') vgCA += +r.gross_revenue;
  }

  // Direct from sales table
  const { data: salesAll } = await sb.from('sales').select('source, gross_revenue').eq('status', 'paid').limit(50000);
  let directNS = 0, directCA = 0;
  for (const r of salesAll || []) {
    if (r.source === 'nuvemshop') directNS += +r.gross_revenue;
    if (r.source === 'conta_azul') directCA += +r.gross_revenue;
  }

  console.log(`  Nuvemshop: View=R$${vgNS.toFixed(2)}  Sales=R$${directNS.toFixed(2)}  ${Math.abs(vgNS - directNS) < 1 ? '✅' : '❌ DIFF'}`);
  console.log(`  Conta Azul: View=R$${vgCA.toFixed(2)}  Sales=R$${directCA.toFixed(2)}  ${Math.abs(vgCA - directCA) < 1 ? '✅' : '❌ DIFF'}`);
  console.log(`  Total faturamento: R$${(vgNS + vgCA).toFixed(2)}`);
  console.log('  Meta Ads NOT included ✅ (rule 3.1)');

  // Check if any meta_ads source leaks into visão geral
  const sources = new Set(allVgRows.map(r => r.source));
  if (sources.has('meta_ads')) {
    console.log('  ❌ BUG: meta_ads found in v_visao_geral_daily!');
  }

  // ============================================
  // 5. CUSTOMERS + ABANDONED
  // ============================================
  console.log('\n=== 5. CUSTOMERS ===');
  const { count: custTotal } = await sb.from('customers').select('*', { count: 'exact', head: true });
  const { count: custNS } = await sb.from('customers').select('*', { count: 'exact', head: true }).eq('source', 'nuvemshop');
  const { count: custCA } = await sb.from('customers').select('*', { count: 'exact', head: true }).eq('source', 'conta_azul');
  console.log(`  Total: ${custTotal} (NS=${custNS}, CA=${custCA})`);

  const { count: abandTotal } = await sb.from('abandoned_checkouts').select('*', { count: 'exact', head: true });
  console.log(`  Abandoned checkouts: ${abandTotal}`);

  // ============================================
  // 6. DATA QUALITY
  // ============================================
  console.log('\n=== 6. DATA QUALITY ===');
  const { count: orphanSales } = await sb.from('sales').select('*', { count: 'exact', head: true }).is('customer_id', null);
  console.log(`  Orphaned sales (no customer): ${orphanSales}`);

  const { count: negRevenue } = await sb.from('sales').select('*', { count: 'exact', head: true }).lt('gross_revenue', 0);
  console.log(`  Negative revenue sales: ${negRevenue}`);

  const { count: zeroItems } = await sb.from('sale_items').select('*', { count: 'exact', head: true }).eq('total_price', 0);
  console.log(`  Sale items with price=0: ${zeroItems}`);

  const { count: futureSales } = await sb.from('sales').select('*', { count: 'exact', head: true }).gt('sale_date', new Date(Date.now() + 86400000).toISOString().split('T')[0]!);
  console.log(`  Future-dated sales: ${futureSales}`);

  const { count: futureMeta } = await sb.from('meta_ads_insights').select('*', { count: 'exact', head: true }).gt('date', new Date(Date.now() + 86400000).toISOString().split('T')[0]!);
  console.log(`  Future-dated meta insights: ${futureMeta}`);

  console.log('\n========================================');
  console.log('QA COMPLETE');
  console.log('========================================');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
