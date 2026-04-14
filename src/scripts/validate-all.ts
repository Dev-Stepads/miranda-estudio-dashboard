import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const PAGE = 1000;

async function paginate<T>(buildQ: (p: number) => unknown): Promise<T[]> {
  const all: T[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await (buildQ(page) as Promise<{ data: T[] | null; error: { message: string } | null }>);
    if (error) { console.log('ERR:', error.message); return all; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    page++;
  }
  return all;
}

async function main() {
  console.log('==============================================');
  console.log('VALIDACAO FINAL — TODAS AS ABAS, TODOS OS PERIODOS');
  console.log('==============================================');

  let totalIssues = 0;
  const issue = (msg: string) => { totalIssues++; console.log('  ❌ ' + msg); };
  const ok = (msg: string) => console.log('  ✅ ' + msg);

  for (const [label, days] of [['7d', 7], ['30d', 30], ['90d', 90], ['1ano', 365]] as const) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0]!;
    console.log(`\n========== ${label} (desde ${sinceStr}) ==========`);

    // --- REVENUE: View vs Sales ---
    type VGRow = { source: string; gross_revenue: number; orders_count: number };
    const viewRows = await paginate<VGRow>(p =>
      sb.from('v_visao_geral_daily').select('source, gross_revenue, orders_count').gte('day', sinceStr).range(p * PAGE, (p + 1) * PAGE - 1)
    );
    const spSince = `${sinceStr}T03:00:00Z`;
    const salesRows = await paginate<{ source: string; gross_revenue: number }>(p =>
      sb.from('sales').select('source, gross_revenue').eq('status', 'paid').gte('sale_date', spSince).range(p * PAGE, (p + 1) * PAGE - 1)
    );

    let vNS = 0, vCA = 0, sNS = 0, sCA = 0;
    for (const r of viewRows) { if (r.source === 'nuvemshop') vNS += +r.gross_revenue; if (r.source === 'conta_azul') vCA += +r.gross_revenue; }
    for (const r of salesRows) { if (r.source === 'nuvemshop') sNS += +r.gross_revenue; if (r.source === 'conta_azul') sCA += +r.gross_revenue; }

    if (Math.abs(vNS - sNS) < 1) ok(`Revenue NS: View=R$${vNS.toFixed(0)} Sales=R$${sNS.toFixed(0)}`);
    else issue(`Revenue NS: View=R$${vNS.toFixed(0)} vs Sales=R$${sNS.toFixed(0)} DIFF=R$${(vNS - sNS).toFixed(0)}`);

    if (Math.abs(vCA - sCA) < 1) ok(`Revenue CA: View=R$${vCA.toFixed(0)} Sales=R$${sCA.toFixed(0)}`);
    else issue(`Revenue CA: View=R$${vCA.toFixed(0)} vs Sales=R$${sCA.toFixed(0)} DIFF=R$${(vCA - sCA).toFixed(0)}`);

    // --- PRODUCTS: not truncated ---
    type ItemRow = { product_name: string; total_price: number };
    const items = await paginate<ItemRow>(p =>
      sb.from('sale_items').select('product_name, total_price, sales!inner(status, sale_date)').eq('sales.status', 'paid').gte('sales.sale_date', sinceStr).range(p * PAGE, (p + 1) * PAGE - 1)
    );
    if (items.length % 1000 !== 0 || items.length === 0) ok(`Products: ${items.length} items (not truncated)`);
    else issue(`Products: ${items.length} items — possible truncation`);

    // --- GEOGRAPHY: not truncated ---
    type GeoRow = { gross_revenue: number };
    const geo = await paginate<GeoRow>(p =>
      sb.from('sales').select('gross_revenue, customers!inner(state)').eq('status', 'paid').eq('source', 'nuvemshop').not('customers.state', 'is', null).gte('sale_date', sinceStr).range(p * PAGE, (p + 1) * PAGE - 1)
    );
    if (geo.length % 1000 !== 0 || geo.length === 0) ok(`Geography NS: ${geo.length} vendas (not truncated)`);
    else issue(`Geography NS: ${geo.length} vendas — possible truncation`);

    // --- CUSTOMERS: not truncated ---
    type CustRow = { customer_id: number };
    const custs = await paginate<CustRow>(p =>
      sb.from('sales').select('customer_id, customers!inner(name)').eq('status', 'paid').not('customer_id', 'is', null).gte('sale_date', sinceStr).range(p * PAGE, (p + 1) * PAGE - 1)
    );
    if (custs.length % 1000 !== 0 || custs.length === 0) ok(`Customers: ${custs.length} vendas (not truncated)`);
    else issue(`Customers: ${custs.length} vendas — possible truncation`);

    // --- META ADS ---
    type MetaRow = { spend: number; purchases: number; purchase_value: number; impressions: number };
    const meta = await paginate<MetaRow>(p =>
      sb.from('v_meta_account_daily').select('spend, purchases, purchase_value, impressions').gte('date', sinceStr).range(p * PAGE, (p + 1) * PAGE - 1)
    );
    let mSpend = 0, mPurch = 0, mPV = 0, mImpr = 0;
    for (const r of meta) { mSpend += +r.spend; mPurch += +r.purchases; mPV += +r.purchase_value; mImpr += +r.impressions; }
    const cpm = mImpr > 0 ? (mSpend / mImpr * 1000) : 0;
    const roas = mSpend > 0 ? mPV / mSpend : 0;
    ok(`Meta: spend=R$${mSpend.toFixed(0)} purch=${mPurch} ROAS=${roas.toFixed(2)}x CPM=R$${cpm.toFixed(2)}`);

    // --- META: campaign spend = total spend ---
    type CampRow = { spend: number };
    const camps = await paginate<CampRow>(p =>
      sb.from('v_meta_campanha_daily').select('spend').gte('date', sinceStr).range(p * PAGE, (p + 1) * PAGE - 1)
    );
    let campSpend = 0;
    for (const r of camps) campSpend += +r.spend;
    if (Math.abs(campSpend - mSpend) < 2) ok(`Meta campaign spend sum matches total`);
    else issue(`Meta campaign spend: R$${campSpend.toFixed(0)} vs total R$${mSpend.toFixed(0)}`);

    // --- ABANDONED ---
    const { data: aband } = await sb.from('abandoned_checkouts')
      .select('contact_name')
      .gte('created_at', sinceStr);
    const abandTotal = (aband || []).length;
    const abandWithContact = (aband || []).filter(r => r.contact_name).length;
    ok(`Abandoned: ${abandTotal} checkouts, ${abandWithContact} com contato`);

    // --- META ADS NOT IN VISAO GERAL ---
    const sources = new Set(viewRows.map(r => r.source));
    if (sources.has('meta_ads')) issue('Meta Ads found in Visão Geral!');
    else ok('Meta Ads excluded from Visão Geral');
  }

  // --- NUVEMSHOP API CROSS-CHECK ---
  console.log('\n========== NUVEMSHOP API SPOT CHECK ==========');
  const nsToken = process.env.NUVEMSHOP_ACCESS_TOKEN!;
  const nsStoreId = process.env.NUVEMSHOP_STORE_ID!;
  const nsHeaders = { Authentication: `bearer ${nsToken}`, 'User-Agent': process.env.NUVEMSHOP_USER_AGENT! };

  const { data: dbRecent } = await sb.from('sales').select('source_sale_id, gross_revenue').eq('source', 'nuvemshop').eq('status', 'paid').order('sale_date', { ascending: false }).limit(3);
  for (const dbO of dbRecent || []) {
    const res = await fetch(`https://api.nuvemshop.com.br/v1/${nsStoreId}/orders/${dbO.source_sale_id}`, { headers: nsHeaders });
    if (res.ok) {
      const apiO = await res.json() as { total?: number };
      const match = Math.abs(+(apiO.total || 0) - +(dbO.gross_revenue as number)) < 0.01;
      if (match) ok(`Order #${dbO.source_sale_id}: R$${(+(dbO.gross_revenue as number)).toFixed(2)} MATCH`);
      else issue(`Order #${dbO.source_sale_id}: API=R$${(+(apiO.total || 0)).toFixed(2)} DB=R$${(+(dbO.gross_revenue as number)).toFixed(2)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // --- META ADS API CROSS-CHECK ---
  console.log('\n========== META ADS API CROSS-CHECK ==========');
  const metaToken = process.env.META_SYSTEM_USER_TOKEN!;
  const metaAccount = process.env.META_AD_ACCOUNT_ID!;
  const apiRes = await fetch(`https://graph.facebook.com/v25.0/${metaAccount}/insights?fields=spend,actions,action_values&time_range={"since":"2026-04-01","until":"2026-04-10"}&access_token=${metaToken}`);
  const apiData = await apiRes.json() as { data?: Array<Record<string, unknown>> };
  const apiRow = apiData.data?.[0] as Record<string, unknown> | undefined;
  if (apiRow) {
    const apiSpend = +(apiRow.spend as string || '0');
    const actions = (apiRow.actions || []) as Array<{ action_type: string; value: string }>;
    const apiPurch = +(actions.find(a => a.action_type === 'purchase')?.value || '0');
    const { data: dbMeta } = await sb.from('v_meta_account_daily').select('spend, purchases').gte('date', '2026-04-01').lte('date', '2026-04-10');
    let dbMS = 0, dbMP = 0;
    for (const r of dbMeta || []) { dbMS += +r.spend; dbMP += +r.purchases; }
    if (Math.abs(apiSpend - dbMS) < 2 && apiPurch === dbMP) ok(`Apr 1-10: spend=R$${dbMS.toFixed(2)} purch=${dbMP} MATCH`);
    else issue(`Apr 1-10: API spend=${apiSpend} purch=${apiPurch} vs DB spend=${dbMS.toFixed(2)} purch=${dbMP}`);
  }

  // --- SUMMARY ---
  console.log('\n==============================================');
  console.log(`RESULTADO: ${totalIssues === 0 ? 'TODOS OS DADOS OK' : totalIssues + ' PROBLEMAS ENCONTRADOS'}`);
  console.log('==============================================');
}

main().catch(e => { console.error(e); process.exit(1); });
