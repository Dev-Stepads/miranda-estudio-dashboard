/**
 * Server-side data queries for the dashboard.
 * Each function fetches from a Supabase view and returns typed data.
 */

import { getSupabase } from './supabase-server';

export interface DailyRevenue {
  day: string;
  source: string;
  orders_count: number;
  gross_revenue: number;
}

export interface TopProduct {
  product_name: string;
  sku: string | null;
  quantity_total: number;
  revenue_total: number;
  quantity_loja_fisica: number;
  quantity_nuvemshop: number;
  revenue_loja_fisica: number;
  revenue_nuvemshop: number;
}

export interface NuvemshopDaily {
  day: string;
  orders_count: number;
  gross_revenue: number;
  avg_ticket: number;
}

export interface GeoData {
  state: string;
  city: string;
  orders_count: number;
  revenue: number;
}

export interface AbandonedData {
  day: string;
  abandoned_count: number;
  total_amount: number;
}

/**
 * Format a Date to YYYY-MM-DD in the dashboard timezone (America/Sao_Paulo).
 * Using Intl to avoid pulling in date-fns-tz dependency.
 */
function toSaoPauloDateStr(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${day}`;
}

/** Parse period from searchParams: supports { days } or { from, to } */
export function parsePeriod(params: { days?: string; from?: string; to?: string }): {
  since: string;
  until: string;
  days: number;
  label: string;
} {
  if (params.from && params.to) {
    const from = new Date(params.from);
    const to = new Date(params.to);
    const diffDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
    return { since: params.from, until: params.to, days: diffDays, label: `${params.from} → ${params.to}` };
  }
  const days = Math.max(1, Number(params.days ?? '30') || 30);
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    since: toSaoPauloDateStr(since),
    until: toSaoPauloDateStr(now),
    days,
    label: `Últimos ${days} dias`,
  };
}

/** Visão Geral: revenue by day and source */
export async function fetchDailyRevenue(days: number = 30, from?: string, to?: string): Promise<DailyRevenue[]> {
  const supabase = getSupabase();

  // PostgREST default limit = 1000. With 2 sources x 730 days (1-year
  // comparison period), this view can return 1460 rows → silently truncated.
  let query = supabase
    .from('v_visao_geral_daily')
    .select('day, source, orders_count, gross_revenue')
    .order('day', { ascending: true })
    .limit(10000);

  if (from && to) {
    query = query.gte('day', from).lte('day', to);
  } else {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('day', since.toISOString().split('T')[0]!);
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetchDailyRevenue: ${error.message}`);
  return (data ?? []) as DailyRevenue[];
}

/** Top products consolidated across sources */
export async function fetchTopProducts(limit: number = 20): Promise<TopProduct[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('v_visao_geral_top_produtos')
    .select('product_name, sku, quantity_total, revenue_total, quantity_loja_fisica, quantity_nuvemshop, revenue_loja_fisica, revenue_nuvemshop')
    .not('product_name', 'is', null)
    .order('revenue_total', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`fetchTopProducts: ${error.message}`);
  return (data ?? []) as TopProduct[];
}

/** Nuvemshop daily for the Nuvemshop tab */
export async function fetchNuvemshopDaily(days: number = 30, from?: string, to?: string): Promise<NuvemshopDaily[]> {
  const supabase = getSupabase();

  // v_nuvemshop_daily has 1820+ rows (2020–2026). PostgREST truncates at 1000.
  let query = supabase
    .from('v_nuvemshop_daily')
    .select('*')
    .order('day', { ascending: true })
    .limit(10000);

  if (from && to) {
    query = query.gte('day', from).lte('day', to);
  } else {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('day', since.toISOString().split('T')[0]!);
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetchNuvemshopDaily: ${error.message}`);
  return (data ?? []) as NuvemshopDaily[];
}

export interface TopCustomer {
  customer_id: number;
  name: string;
  state: string | null;
  source: string;
  orders_count: number;
  total_revenue: number;
  avg_ticket: number;
}

/** Top customers by revenue. Optional source filter. */
export async function fetchTopCustomers(limit: number = 15, source?: string): Promise<TopCustomer[]> {
  const supabase = getSupabase();

  let query = supabase
    .from('v_top_customers')
    .select('*')
    .order('total_revenue', { ascending: false })
    .limit(limit);

  if (source !== undefined) {
    query = query.eq('source', source);
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetchTopCustomers: ${error.message}`);
  return (data ?? []) as TopCustomer[];
}

/** Geography (Nuvemshop) */
export async function fetchGeography(limit: number = 15): Promise<GeoData[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('v_nuvemshop_geografia')
    .select('state, city, orders_count, revenue')
    .not('state', 'is', null)
    .order('revenue', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`fetchGeography: ${error.message}`);
  return (data ?? []) as GeoData[];
}

/** Geography (Conta Azul — Loja Física) */
export async function fetchGeographyCA(limit: number = 15): Promise<GeoData[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('v_loja_fisica_geografia')
    .select('state, city, orders_count, revenue')
    .not('state', 'is', null)
    .order('revenue', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`fetchGeographyCA: ${error.message}`);
  return (data ?? []) as GeoData[];
}

export interface GeoConsolidated {
  state: string;
  orders_count: number;
  revenue: number;
  revenue_nuvemshop: number;
  revenue_conta_azul: number;
}

/** Geography consolidated (both sources) */
export async function fetchGeographyConsolidated(limit: number = 15): Promise<GeoConsolidated[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('v_geografia_consolidada')
    .select('*')
    .order('revenue', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`fetchGeographyConsolidated: ${error.message}`);
  return (data ?? []) as GeoConsolidated[];
}

export interface MonthlyData {
  month: string;
  revenue: number;
  orders: number;
  avgTicket: number;
  changePercent: number | null;
}

/** Monthly comparison — all sources consolidated */
export async function fetchMonthlyComparison(months: number = 12): Promise<MonthlyData[]> {
  const supabase = getSupabase();

  // Paginate to get ALL rows (Supabase default limit is 1000)
  const allRows: Array<{ day: string; gross_revenue: number; orders_count: number }> = [];
  let page = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data: batch, error } = await supabase
      .from('v_visao_geral_daily')
      .select('day, gross_revenue, orders_count')
      .order('day', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw new Error(`fetchMonthlyComparison: ${error.message}`);
    if (batch === null || batch.length === 0) break;
    allRows.push(...(batch as typeof allRows));
    if (batch.length < PAGE_SIZE) break;
    page++;
  }

  // Aggregate by month
  const byMonth = new Map<string, { revenue: number; orders: number }>();
  for (const row of allRows) {
    const month = row.day.slice(0, 7); // "2026-04"
    const existing = byMonth.get(month) ?? { revenue: 0, orders: 0 };
    existing.revenue += row.gross_revenue;
    existing.orders += row.orders_count;
    byMonth.set(month, existing);
  }

  // Sort descending (most recent first) and limit
  const sorted = Array.from(byMonth.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, months);

  // Calculate % change vs previous month
  const result: MonthlyData[] = sorted.map(([month, vals], i) => {
    const prevMonth = sorted[i + 1];
    const prevRevenue = prevMonth ? prevMonth[1].revenue : null;
    const changePercent = prevRevenue !== null && prevRevenue > 0
      ? ((vals.revenue - prevRevenue) / prevRevenue) * 100
      : null;

    return {
      month,
      revenue: vals.revenue,
      orders: vals.orders,
      avgTicket: vals.orders > 0 ? vals.revenue / vals.orders : 0,
      changePercent,
    };
  });

  return result;
}

export interface RecentOrder {
  sale_id: number;
  source: string;
  sale_date: string;
  gross_revenue: number;
  status: string;
  payment_method: string | null;
  customer_name: string | null;
}

/** Recent orders (last N) across all sources */
export async function fetchRecentOrders(limit: number = 10): Promise<RecentOrder[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('sales')
    .select('sale_id, source, sale_date, gross_revenue, status, payment_method, customers(name)')
    .order('sale_date', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`fetchRecentOrders: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    sale_id: row.sale_id as number,
    source: row.source as string,
    sale_date: row.sale_date as string,
    gross_revenue: row.gross_revenue as number,
    status: row.status as string,
    payment_method: row.payment_method as string | null,
    customer_name: (row.customers as Record<string, unknown> | null)?.name as string | null ?? null,
  }));
}

export interface CustomerRecurrence {
  source: string;
  first_time_buyers: number;
  repeat_buyers: number;
  total_customers: number;
  repeat_rate: number;
}

/** Customer recurrence (repeat vs first-time buyers) */
export async function fetchCustomerRecurrence(): Promise<CustomerRecurrence[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('v_customer_recurrence')
    .select('*');

  if (error) throw new Error(`fetchCustomerRecurrence: ${error.message}`);
  return (data ?? []) as CustomerRecurrence[];
}

// ============================================================
// Meta Ads
// ============================================================

export interface MetaDailyRow {
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  ctr_pct: number;
  cpc: number;
  cpm: number;
  roas: number;
}

export interface MetaRankingRow {
  campaign_id: string;
  campaign_name: string | null;
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  total_purchases: number;
  total_purchase_value: number;
  roas: number;
}

export interface MetaAdsetRankingRow extends MetaRankingRow {
  adset_id: string;
  adset_name: string | null;
}

export interface MetaAdRankingRow extends MetaAdsetRankingRow {
  ad_id: string;
  ad_name: string | null;
}

/** Meta Ads daily series (account-level totals). */
export async function fetchMetaDaily(
  days: number = 30,
  from?: string,
  to?: string,
): Promise<MetaDailyRow[]> {
  const supabase = getSupabase();

  let query = supabase
    .from('v_meta_account_daily')
    .select('*')
    .order('date', { ascending: true })
    .limit(10000);

  if (from && to) {
    query = query.gte('date', from).lte('date', to);
  } else {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('date', since.toISOString().split('T')[0]!);
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetchMetaDaily: ${error.message}`);
  return (data ?? []) as MetaDailyRow[];
}

/**
 * Meta Ads — ranking agregado de campanhas no período.
 * Somamos em memória a partir da série diária por campanha pra respeitar
 * o filtro de período (as views de ranking hoje somam tudo que tem no banco).
 */
export async function fetchMetaCampaignRanking(
  days: number = 30,
  from?: string,
  to?: string,
  limit: number = 15,
): Promise<MetaRankingRow[]> {
  const supabase = getSupabase();

  // PostgREST default limit = 1000 rows. With 9+ campaigns x 365 days
  // a 1-year filter hits 3000+ rows → silently truncated. Explicit limit.
  let query = supabase
    .from('v_meta_campanha_daily')
    .select('date, campaign_id, campaign_name, spend, impressions, clicks, purchases, purchase_value')
    .limit(10000);

  if (from && to) {
    query = query.gte('date', from).lte('date', to);
  } else {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('date', since.toISOString().split('T')[0]!);
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetchMetaCampaignRanking: ${error.message}`);

  const byCampaign = new Map<string, MetaRankingRow>();
  for (const row of (data ?? []) as Array<{
    campaign_id: string;
    campaign_name: string | null;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchase_value: number;
  }>) {
    const key = row.campaign_id;
    const existing = byCampaign.get(key) ?? {
      campaign_id: key,
      campaign_name: row.campaign_name,
      total_spend: 0,
      total_impressions: 0,
      total_clicks: 0,
      total_purchases: 0,
      total_purchase_value: 0,
      roas: 0,
    };
    existing.total_spend += row.spend ?? 0;
    existing.total_impressions += row.impressions ?? 0;
    existing.total_clicks += row.clicks ?? 0;
    existing.total_purchases += row.purchases ?? 0;
    existing.total_purchase_value += row.purchase_value ?? 0;
    byCampaign.set(key, existing);
  }

  const result = Array.from(byCampaign.values())
    .map((c) => ({
      ...c,
      roas: c.total_spend > 0 ? c.total_purchase_value / c.total_spend : 0,
    }))
    .sort((a, b) => b.total_spend - a.total_spend)
    .slice(0, limit);

  return result;
}

/** Ranking de criativos (nível ad) no período. */
export async function fetchMetaAdRanking(
  days: number = 30,
  from?: string,
  to?: string,
  limit: number = 15,
): Promise<MetaAdRankingRow[]> {
  const supabase = getSupabase();

  // v_meta_ranking_criativos soma todo o histórico — pra respeitar
  // período, consultamos a tabela base e agregamos aqui.
  // PostgREST default limit = 1000. 15+ ads x 365 days = 5000+ rows.
  let query = supabase
    .from('meta_ads_insights')
    .select('ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, spend, impressions, clicks, purchases, purchase_value, date')
    .eq('level', 'ad')
    .limit(10000);

  if (from && to) {
    query = query.gte('date', from).lte('date', to);
  } else {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('date', since.toISOString().split('T')[0]!);
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetchMetaAdRanking: ${error.message}`);

  const byAd = new Map<string, MetaAdRankingRow>();
  for (const row of (data ?? []) as Array<{
    ad_id: string | null;
    ad_name: string | null;
    adset_id: string | null;
    adset_name: string | null;
    campaign_id: string;
    campaign_name: string | null;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchase_value: number;
  }>) {
    if (row.ad_id === null) continue;
    const key = row.ad_id;
    const existing = byAd.get(key) ?? {
      ad_id: row.ad_id,
      ad_name: row.ad_name,
      adset_id: row.adset_id ?? '',
      adset_name: row.adset_name,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      total_spend: 0,
      total_impressions: 0,
      total_clicks: 0,
      total_purchases: 0,
      total_purchase_value: 0,
      roas: 0,
    };
    existing.total_spend += row.spend ?? 0;
    existing.total_impressions += row.impressions ?? 0;
    existing.total_clicks += row.clicks ?? 0;
    existing.total_purchases += row.purchases ?? 0;
    existing.total_purchase_value += row.purchase_value ?? 0;
    byAd.set(key, existing);
  }

  const result = Array.from(byAd.values())
    .map((a) => ({
      ...a,
      roas: a.total_spend > 0 ? a.total_purchase_value / a.total_spend : 0,
    }))
    .sort((a, b) => b.total_spend - a.total_spend)
    .slice(0, limit);

  return result;
}

/** Abandoned checkouts (Nuvemshop) */
export async function fetchAbandoned(): Promise<AbandonedData[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('v_nuvemshop_abandonados')
    .select('*')
    .order('day', { ascending: false })
    .limit(30);

  if (error) throw new Error(`fetchAbandoned: ${error.message}`);
  return (data ?? []) as AbandonedData[];
}
