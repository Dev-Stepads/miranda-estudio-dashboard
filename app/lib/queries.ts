/**
 * Server-side data queries for the dashboard.
 * Each function fetches from a Supabase view and returns typed data.
 */

import { getSupabase } from './supabase-server';

const PAGE_SIZE = 1000;

/**
 * Convert a YYYY-MM-DD date string to a timestamptz at midnight São Paulo
 * (UTC-3). Used when filtering sale_date (timestamptz) to match the same
 * day boundaries as the views, which use `at time zone 'America/Sao_Paulo'`.
 * Without this, sales between 00:00-03:00 UTC fall on different days in
 * the view vs the direct query, causing revenue diffs on long periods.
 */
function toSPTimestamp(dateStr: string): string {
  return `${dateStr}T03:00:00Z`;
}

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
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 1825; // 5 years

export function parsePeriod(params: { days?: string; from?: string; to?: string }): {
  since: string;
  until: string;
  days: number;
  label: string;
} {
  if (params.from && params.to && DATE_REGEX.test(params.from) && DATE_REGEX.test(params.to)) {
    const from = new Date(params.from);
    const to = new Date(params.to);
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && to >= from) {
      const diffDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
      return { since: params.from, until: params.to, days: diffDays, label: `${params.from} → ${params.to}` };
    }
  }
  const days = Math.min(MAX_DAYS, Math.max(1, Number(params.days ?? '30') || 30));
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    since: toSaoPauloDateStr(since),
    until: toSaoPauloDateStr(now),
    days,
    label: `Últimos ${days} dias`,
  };
}

/**
 * Compute the previous period with the SAME length as [since, until], immediately
 * preceding it. Used for % change KPI comparison.
 *
 * Why this exists: the old pattern was `fetchDailyRevenue(days * 2)` + filter by
 * `day < since`. That broke for custom date ranges (e.g. "March 2026" gave only
 * ~12 days of Feb as "previous" because the query always started from today) and
 * for "1 ano" (previous range extended past the data floor, returning 0 and
 * yielding a fake +100%). The fix is to compute the previous window explicitly
 * and fetch it with an exact from/to.
 *
 * Example: since="2026-03-01", until="2026-03-31" → prevSince="2026-01-30",
 * prevUntil="2026-02-28" (30-day window immediately before March).
 */
export function getPreviousPeriod(since: string, until: string): {
  prevSince: string;
  prevUntil: string;
} {
  const sinceDate = new Date(`${since}T00:00:00Z`);
  const untilDate = new Date(`${until}T00:00:00Z`);
  const lengthMs = untilDate.getTime() - sinceDate.getTime();
  const prevUntilDate = new Date(sinceDate.getTime() - 24 * 60 * 60 * 1000);
  const prevSinceDate = new Date(prevUntilDate.getTime() - lengthMs);
  return {
    prevSince: prevSinceDate.toISOString().split('T')[0]!,
    prevUntil: prevUntilDate.toISOString().split('T')[0]!,
  };
}

/** Visão Geral: revenue by day and source */
export async function fetchDailyRevenue(days: number = 30, from?: string, to?: string): Promise<DailyRevenue[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  const all: DailyRevenue[] = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('v_visao_geral_daily')
      .select('day, source, orders_count, gross_revenue')
      .order('day', { ascending: true })
      .gte('day', sinceStr)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (to) q = q.lte('day', to);
    const { data, error } = await q;
    if (error) throw new Error(`fetchDailyRevenue: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as DailyRevenue[]));
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

/**
 * Top products consolidated across sources, filtered by period.
 *
 * Excludes CA vendas with `nstag-` prefix — those are NS orders tagged
 * by the CA "Nuvem Shop" origem and are tracked separately to make
 * sum(CA) match `totais.aprovado`. If we included them in product
 * rankings, NS products would show up twice (once via NS source, once
 * via CA nstag). See DECISOES 2026-04-15b.
 */
export async function fetchTopProducts(limit: number = 20, days: number = 30, from?: string, to?: string): Promise<TopProduct[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();
  const untilStr = to;

  // Paginate past PostgREST 1000-row default limit
  const allItems: Array<Record<string, unknown>> = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('sale_items')
      .select('product_name, sku, quantity, total_price, sales!inner(source, source_sale_id, sale_date, status)')
      .eq('sales.status', 'paid')
      .not('product_name', 'is', null)
      .not('sales.source_sale_id', 'ilike', 'nstag-%')
      .gte('sales.sale_date', toSPTimestamp(sinceStr))
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (untilStr) q = q.lte('sales.sale_date', toSPTimestamp(untilStr));
    const { data, error } = await q;
    if (error) throw new Error(`fetchTopProducts: ${error.message}`);
    if (!data || data.length === 0) break;
    allItems.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  // Aggregate by product_name
  const byProduct = new Map<string, TopProduct>();
  for (const row of allItems as unknown as Array<{
    product_name: string; sku: string | null; quantity: number; total_price: number;
    sales: { source: string } | Array<{ source: string }>;
  }>) {
    const salesObj = Array.isArray(row.sales) ? row.sales[0] : row.sales;
    const source = salesObj?.source ?? 'unknown';
    const key = row.product_name;
    const existing = byProduct.get(key) ?? {
      product_name: key, sku: row.sku, quantity_total: 0, revenue_total: 0,
      quantity_loja_fisica: 0, quantity_nuvemshop: 0, revenue_loja_fisica: 0, revenue_nuvemshop: 0,
    };
    existing.quantity_total += row.quantity;
    existing.revenue_total += row.total_price;
    if (source === 'conta_azul') {
      existing.quantity_loja_fisica += row.quantity;
      existing.revenue_loja_fisica += row.total_price;
    } else {
      existing.quantity_nuvemshop += row.quantity;
      existing.revenue_nuvemshop += row.total_price;
    }
    if (row.sku) existing.sku = row.sku;
    byProduct.set(key, existing);
  }

  // Round accumulated values to 2 decimal places to prevent floating-point drift
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return Array.from(byProduct.values())
    .map((p) => ({
      ...p,
      revenue_total: round2(p.revenue_total),
      revenue_loja_fisica: round2(p.revenue_loja_fisica),
      revenue_nuvemshop: round2(p.revenue_nuvemshop),
    }))
    .sort((a, b) => b.revenue_total - a.revenue_total)
    .slice(0, limit);
}

/** Nuvemshop daily for the Nuvemshop tab */
export async function fetchNuvemshopDaily(days: number = 30, from?: string, to?: string): Promise<NuvemshopDaily[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  const all: NuvemshopDaily[] = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('v_nuvemshop_daily')
      .select('*')
      .order('day', { ascending: true })
      .gte('day', sinceStr)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (to) q = q.lte('day', to);
    const { data, error } = await q;
    if (error) throw new Error(`fetchNuvemshopDaily: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as NuvemshopDaily[]));
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

export interface TopCustomer {
  customer_id: number;
  name: string;
  state: string | null;
  source: string;
  orders_count: number;
  total_revenue: number;
  avg_ticket: number;
  customer_type: 'pessoa' | 'empresa';
  email: string | null;
  phone: string | null;
}

const BUSINESS_SUFFIXES = /\b(LTDA|S\.?A\.?|EIRELI|MEI|EPP|COMERCIO|SERVICOS|EMPREENDIMENTOS|PRODUCOES|INDUSTRIA|DISTRIBUIDORA|HOTELEIRA|MATERIAIS|INSTITUTO)\b/i;

/**
 * Classify a customer as pessoa or empresa.
 * - Conta Azul: source_customer_id is CPF (<=11 digits) or CNPJ (>=12 digits)
 * - Nuvemshop: no CPF/CNPJ stored, so use name heuristics
 */
function classifyCustomer(name: string, source: string, sourceCustomerId?: string): 'pessoa' | 'empresa' {
  // Conta Azul: use CPF/CNPJ length (only if it looks like a document, not a UUID)
  if (source === 'conta_azul' && sourceCustomerId) {
    const digits = sourceCustomerId.replace(/\D/g, '');
    // CPF = 11 digits, CNPJ = 14 digits. UUIDs have 32 hex chars — skip those.
    if (digits.length <= 14) {
      if (digits.length >= 12) return 'empresa';
      return 'pessoa';
    }
    // Fallback to name heuristics for UUID-based source_customer_ids
  }
  // Name heuristics: business names typically have legal suffixes
  if (BUSINESS_SUFFIXES.test(name)) return 'empresa';
  return 'pessoa';
}

/**
 * Top customers by revenue, filtered by period. Optional source filter.
 * Excludes CA vendas with `nstag-` prefix (see fetchTopProducts).
 */
export async function fetchTopCustomers(limit: number = 15, source?: string, days: number = 30, from?: string, to?: string): Promise<TopCustomer[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  const allRows: Array<Record<string, unknown>> = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('sales')
      .select('customer_id, source, source_sale_id, gross_revenue, customers!inner(name, state, source_customer_id, email, phone)')
      .eq('status', 'paid')
      .not('customer_id', 'is', null)
      .not('source_sale_id', 'ilike', 'nstag-%')
      .gte('sale_date', toSPTimestamp(sinceStr))
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (source !== undefined) q = q.eq('source', source);
    if (to) q = q.lte('sale_date', toSPTimestamp(to) );
    const { data, error } = await q;
    if (error) throw new Error(`fetchTopCustomers: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  const byCustomer = new Map<number, TopCustomer>();
  for (const row of allRows as unknown as Array<{
    customer_id: number; source: string; gross_revenue: number;
    customers: { name: string; state: string | null; source_customer_id: string; email: string | null; phone: string | null } | Array<{ name: string; state: string | null; source_customer_id: string; email: string | null; phone: string | null }>;
  }>) {
    const cust = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    if (!cust) continue;
    const existing = byCustomer.get(row.customer_id) ?? {
      customer_id: row.customer_id, name: cust.name,
      state: cust.state, source: row.source,
      orders_count: 0, total_revenue: 0, avg_ticket: 0,
      customer_type: classifyCustomer(cust.name, row.source, cust.source_customer_id),
      email: cust.email, phone: cust.phone,
    };
    existing.orders_count += 1;
    existing.total_revenue += row.gross_revenue;
    byCustomer.set(row.customer_id, existing);
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return Array.from(byCustomer.values())
    .map(c => ({
      ...c,
      total_revenue: round2(c.total_revenue),
      avg_ticket: c.orders_count > 0 ? round2(c.total_revenue / c.orders_count) : 0,
    }))
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, limit);
}

/** Geography (Nuvemshop), filtered by period */
export async function fetchGeography(limit: number = 15, days: number = 30, from?: string, to?: string): Promise<GeoData[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  const allRows: Array<Record<string, unknown>> = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('sales')
      .select('gross_revenue, customers!inner(state, city)')
      .eq('status', 'paid')
      .eq('source', 'nuvemshop')
      .not('customers.state', 'is', null)
      .gte('sale_date', toSPTimestamp(sinceStr))
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (to) q = q.lte('sale_date', toSPTimestamp(to) );
    const { data, error } = await q;
    if (error) throw new Error(`fetchGeography: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  const byState = new Map<string, GeoData>();
  for (const row of allRows as unknown as Array<{ gross_revenue: number; customers: { state: string; city: string } | Array<{ state: string; city: string }> }>) {
    const c = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    const state = c?.state;
    if (!state) continue;
    const existing = byState.get(state) ?? { state, city: '', orders_count: 0, revenue: 0 };
    existing.orders_count += 1;
    existing.revenue += row.gross_revenue;
    byState.set(state, existing);
  }

  return Array.from(byState.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/** Geography (Conta Azul — Loja Física), filtered by period. Excludes nstag-. */
export async function fetchGeographyCA(limit: number = 15, days: number = 30, from?: string, to?: string): Promise<GeoData[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  const allRows: Array<Record<string, unknown>> = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('sales')
      .select('gross_revenue, source_sale_id, customers!inner(state, city)')
      .eq('status', 'paid')
      .eq('source', 'conta_azul')
      .not('source_sale_id', 'ilike', 'nstag-%')
      .not('customers.state', 'is', null)
      .gte('sale_date', toSPTimestamp(sinceStr))
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (to) q = q.lte('sale_date', toSPTimestamp(to) );
    const { data, error } = await q;
    if (error) throw new Error(`fetchGeographyCA: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  const byState = new Map<string, GeoData>();
  for (const row of allRows as unknown as Array<{ gross_revenue: number; customers: { state: string; city: string } | Array<{ state: string; city: string }> }>) {
    const c = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    const state = c?.state;
    if (!state) continue;
    const existing = byState.get(state) ?? { state, city: '', orders_count: 0, revenue: 0 };
    existing.orders_count += 1;
    existing.revenue += row.gross_revenue;
    byState.set(state, existing);
  }

  return Array.from(byState.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export interface GeoConsolidated {
  state: string;
  orders_count: number;
  revenue: number;
  revenue_nuvemshop: number;
  revenue_conta_azul: number;
}

/** Geography consolidated (both sources), filtered by period. Excludes nstag-. */
export async function fetchGeographyConsolidated(limit: number = 15, days: number = 30, from?: string, to?: string): Promise<GeoConsolidated[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  const allRows: Array<Record<string, unknown>> = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('sales')
      .select('source, source_sale_id, gross_revenue, customers!inner(state)')
      .eq('status', 'paid')
      .not('source_sale_id', 'ilike', 'nstag-%')
      .not('customers.state', 'is', null)
      .gte('sale_date', toSPTimestamp(sinceStr))
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (to) q = q.lte('sale_date', toSPTimestamp(to) );
    const { data, error } = await q;
    if (error) throw new Error(`fetchGeographyConsolidated: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  const byState = new Map<string, GeoConsolidated>();
  for (const row of allRows as unknown as Array<{ source: string; gross_revenue: number; customers: { state: string } | Array<{ state: string }> }>) {
    const c = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    const state = c?.state;
    if (!state) continue;
    const existing = byState.get(state) ?? {
      state, orders_count: 0, revenue: 0, revenue_nuvemshop: 0, revenue_conta_azul: 0,
    };
    existing.orders_count += 1;
    existing.revenue += row.gross_revenue;
    if (row.source === 'nuvemshop') existing.revenue_nuvemshop += row.gross_revenue;
    if (row.source === 'conta_azul') existing.revenue_conta_azul += row.gross_revenue;
    byState.set(state, existing);
  }

  return Array.from(byState.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export interface MonthlyData {
  month: string;
  revenue: number;
  orders: number;
  avgTicket: number;
  changePercent: number | null;
  /** True when this month is the current (incomplete) one — the revenue/orders
   * reflect only days 1..N where N is the last day with data. The changePercent
   * for a partial month is computed against the PREVIOUS month's first N days,
   * so the comparison stays fair (not partial-month vs full-month). */
  partial: boolean;
}

/**
 * Monthly comparison — "all sources consolidated".
 *
 * Uses sum(CA) alone because sum(CA) = totais.aprovado which already
 * includes NS-tagged vendas (Miranda's "Faturamento Total"). Summing
 * CA + NS here would double-count the NS overlap.
 * See DECISOES 2026-04-15b.
 *
 * Partial-month handling (2026-04-16): the most recent month is flagged
 * `partial: true` when its last day with data is before the last calendar
 * day of that month. The `changePercent` for a partial month is computed
 * against the PREVIOUS month's first N days (N = days with data in the
 * partial month), so the comparison is day-to-day fair instead of
 * partial-vs-full (which was giving misleading -50% style badges).
 */
export async function fetchMonthlyComparison(months: number = 12): Promise<MonthlyData[]> {
  const supabase = getSupabase();

  // Compute date floor: (months + 1) months ago, to have 1 extra month
  // for the changePercent of the oldest displayed month.
  const floorDate = new Date();
  floorDate.setMonth(floorDate.getMonth() - months - 1);
  const floorStr = toSaoPauloDateStr(floorDate);

  // Paginate to get rows from floor date onward (not ALL history)
  const allRows: Array<{ day: string; gross_revenue: number; orders_count: number }> = [];
  let page = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .from('v_visao_geral_daily')
      .select('day, gross_revenue, orders_count')
      .eq('source', 'conta_azul')
      .gte('day', floorStr)
      .order('day', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw new Error(`fetchMonthlyComparison: ${error.message}`);
    if (batch === null || batch.length === 0) break;
    allRows.push(...(batch as typeof allRows));
    if (batch.length < PAGE_SIZE) break;
    page++;
  }

  // Aggregate by month with per-day detail (needed for partial comparisons)
  const byMonth = new Map<string, { revenue: number; orders: number; lastDay: number }>();
  for (const row of allRows) {
    const month = row.day.slice(0, 7); // "2026-04"
    const dayOfMonth = Number(row.day.slice(8, 10)); // "15"
    const existing = byMonth.get(month) ?? { revenue: 0, orders: 0, lastDay: 0 };
    existing.revenue += row.gross_revenue;
    existing.orders += row.orders_count;
    existing.lastDay = Math.max(existing.lastDay, dayOfMonth);
    byMonth.set(month, existing);
  }

  // Detect which months are "partial" — the most recent one if its lastDay
  // is before the month's total days. We only flag the chronologically-last
  // month as partial; earlier months with gaps are assumed complete (gaps
  // there would indicate sync issues, not "in-progress" months).
  const sortedMonthsAsc = Array.from(byMonth.keys()).sort();
  const latestMonth = sortedMonthsAsc[sortedMonthsAsc.length - 1];
  function totalDaysInMonth(monthStr: string): number {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(y!, m!, 0).getDate(); // day 0 of next month = last day of this month
  }

  // Sort descending (most recent first) and limit
  const sorted = Array.from(byMonth.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, months);

  // Calculate % change vs previous month. For a partial month, compare
  // only the first N days against the previous month's first N days.
  const result: MonthlyData[] = sorted.map(([month, vals], i) => {
    const prevMonth = sorted[i + 1];
    const isPartial = month === latestMonth && vals.lastDay < totalDaysInMonth(month);

    let prevRevenue: number | null = null;
    if (prevMonth) {
      if (isPartial) {
        // Sum prev-month revenue for days 1..vals.lastDay only
        const prevMonthKey = prevMonth[0];
        prevRevenue = allRows
          .filter(r => r.day.startsWith(prevMonthKey) && Number(r.day.slice(8, 10)) <= vals.lastDay)
          .reduce((s, r) => s + r.gross_revenue, 0);
      } else {
        prevRevenue = prevMonth[1].revenue;
      }
    }

    const changePercent = prevRevenue !== null && prevRevenue > 0
      ? ((vals.revenue - prevRevenue) / prevRevenue) * 100
      : null;

    return {
      month,
      revenue: vals.revenue,
      orders: vals.orders,
      avgTicket: vals.orders > 0 ? vals.revenue / vals.orders : 0,
      changePercent,
      partial: isPartial,
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

/** Recent orders within the period. Excludes CA nstag- (NS duplicates). */
export async function fetchRecentOrders(limit: number = 10, days: number = 30, from?: string, to?: string): Promise<RecentOrder[]> {
  const supabase = getSupabase();

  let query = supabase
    .from('sales')
    .select('sale_id, source, source_sale_id, sale_date, gross_revenue, status, payment_method, customers(name)')
    .not('source_sale_id', 'ilike', 'nstag-%')
    .order('sale_date', { ascending: false })
    .limit(limit);

  if (from && to) {
    query = query.gte('sale_date', toSPTimestamp(from)).lte('sale_date', toSPTimestamp(to));
  } else {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('sale_date', toSPTimestamp(since.toISOString().split('T')[0]!));
  }

  const { data, error } = await query;

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

/** Customer recurrence (repeat vs first-time buyers), filtered by period */
export async function fetchCustomerRecurrence(days: number = 30, from?: string, to?: string): Promise<CustomerRecurrence[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  // Query sales with customer_id, filtered by period. Excludes nstag-.
  const allRows = await (async () => {
    const rows: Array<{ customer_id: number; source: string }> = [];
    let page = 0;
    while (true) {
      let q = supabase
        .from('sales')
        .select('customer_id, source, source_sale_id')
        .eq('status', 'paid')
        .not('customer_id', 'is', null)
        .not('source_sale_id', 'ilike', 'nstag-%')
        .gte('sale_date', toSPTimestamp(sinceStr))
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (to) q = q.lte('sale_date', toSPTimestamp(to));
      const { data, error } = await q;
      if (error) throw new Error(`fetchCustomerRecurrence: ${error.message}`);
      if (!data || data.length === 0) break;
      rows.push(...(data as typeof rows));
      if (data.length < PAGE_SIZE) break;
      page++;
    }
    return rows;
  })();

  // Count orders per customer per source
  const customerOrders = new Map<string, number>();
  for (const r of allRows) {
    const key = `${r.source}|${r.customer_id}`;
    customerOrders.set(key, (customerOrders.get(key) ?? 0) + 1);
  }

  // Aggregate by source
  const bySource = new Map<string, { first: number; repeat: number }>();
  for (const [key, count] of customerOrders) {
    const source = key.split('|')[0]!;
    const existing = bySource.get(source) ?? { first: 0, repeat: 0 };
    if (count === 1) existing.first++;
    else existing.repeat++;
    bySource.set(source, existing);
  }

  return Array.from(bySource.entries()).map(([source, { first, repeat }]) => ({
    source,
    first_time_buyers: first,
    repeat_buyers: repeat,
    total_customers: first + repeat,
    repeat_rate: (first + repeat) > 0 ? Math.round((repeat / (first + repeat)) * 1000) / 10 : 0,
  }));
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
  total_leads: number;
  roas: number;
  cpl: number;
}

export interface MetaAdsetRankingRow extends MetaRankingRow {
  adset_id: string;
  adset_name: string | null;
}

export interface MetaAdRankingRow extends MetaAdsetRankingRow {
  ad_id: string;
  ad_name: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
}

/** Meta Ads daily series (account-level totals). */
export async function fetchMetaDaily(
  days: number = 30,
  from?: string,
  to?: string,
): Promise<MetaDailyRow[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  const all: MetaDailyRow[] = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('v_meta_account_daily')
      .select('*')
      .order('date', { ascending: true })
      .gte('date', sinceStr)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (to) q = q.lte('date', to);
    const { data, error } = await q;
    if (error) throw new Error(`fetchMetaDaily: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as MetaDailyRow[]));
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return all;
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

  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  const allRows: Array<Record<string, unknown>> = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('meta_ads_insights')
      .select('date, campaign_id, campaign_name, spend, impressions, clicks, purchases, purchase_value, leads')
      .eq('level', 'campaign')
      .gte('date', sinceStr)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (to) q = q.lte('date', to);
    const { data, error } = await q;
    if (error) throw new Error(`fetchMetaCampaignRanking: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  const byCampaign = new Map<string, MetaRankingRow>();
  for (const row of allRows as Array<{
    campaign_id: string;
    campaign_name: string | null;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    purchase_value: number;
    leads: number | null;
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
      total_leads: 0,
      roas: 0,
      cpl: 0,
    };
    existing.total_spend += row.spend ?? 0;
    existing.total_impressions += row.impressions ?? 0;
    existing.total_clicks += row.clicks ?? 0;
    existing.total_purchases += row.purchases ?? 0;
    existing.total_purchase_value += row.purchase_value ?? 0;
    existing.total_leads += row.leads ?? 0;
    byCampaign.set(key, existing);
  }

  const result = Array.from(byCampaign.values())
    .map((c) => ({
      ...c,
      roas: c.total_spend > 0 ? c.total_purchase_value / c.total_spend : 0,
      cpl: c.total_leads > 0 ? c.total_spend / c.total_leads : 0,
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

  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  const allRows: Array<Record<string, unknown>> = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('meta_ads_insights')
      .select('ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, spend, impressions, clicks, purchases, purchase_value, leads, date')
      .eq('level', 'ad')
      .gte('date', sinceStr)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (to) q = q.lte('date', to);
    const { data, error } = await q;
    if (error) throw new Error(`fetchMetaAdRanking: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  const byAd = new Map<string, MetaAdRankingRow>();
  for (const row of allRows as Array<{
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
    leads: number | null;
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
      total_leads: 0,
      roas: 0,
      cpl: 0,
      thumbnail_url: null,
      image_url: null,
    };
    existing.total_spend += row.spend ?? 0;
    existing.total_impressions += row.impressions ?? 0;
    existing.total_clicks += row.clicks ?? 0;
    existing.total_purchases += row.purchases ?? 0;
    existing.total_purchase_value += row.purchase_value ?? 0;
    existing.total_leads += row.leads ?? 0;
    byAd.set(key, existing);
  }

  const aggregated = Array.from(byAd.values())
    .map((a) => ({
      ...a,
      roas: a.total_spend > 0 ? a.total_purchase_value / a.total_spend : 0,
      cpl: a.total_leads > 0 ? a.total_spend / a.total_leads : 0,
    }))
    .sort((a, b) => b.total_spend - a.total_spend)
    .slice(0, limit);

  // Second pass: buscar thumbnails da tabela meta_ads_creatives pros
  // ad_ids que entraram no top N. Mesmo se a tabela nao existir ainda
  // (migration pendente), o frontend degrada graciosamente pra null.
  const topAdIds = aggregated.map((a) => a.ad_id);
  if (topAdIds.length > 0) {
    const { data: creatives, error: creativesErr } = await supabase
      .from('meta_ads_creatives')
      .select('ad_id, thumbnail_url, image_url')
      .in('ad_id', topAdIds);

    if (creativesErr) {
      // Log-and-continue: se a tabela nao existe ou o query falha, a
      // aba continua funcionando sem thumbnails.
      console.warn('[fetchMetaAdRanking] creatives lookup failed:', creativesErr.message);
    } else if (creatives) {
      const byId = new Map(
        (creatives as Array<{ ad_id: string; thumbnail_url: string | null; image_url: string | null }>).map(
          (c) => [c.ad_id, c],
        ),
      );
      for (const row of aggregated) {
        const hit = byId.get(row.ad_id);
        if (hit) {
          row.thumbnail_url = hit.thumbnail_url;
          row.image_url = hit.image_url;
        }
      }
    }
  }

  return aggregated;
}

/** Abandoned checkouts (Nuvemshop), filtered by period */
export async function fetchAbandoned(days: number = 30, from?: string, to?: string): Promise<AbandonedData[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  const all: AbandonedData[] = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('v_nuvemshop_abandonados')
      .select('*')
      .order('day', { ascending: false })
      .gte('day', sinceStr)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (to) q = q.lte('day', to);
    const { data, error } = await q;
    if (error) throw new Error(`fetchAbandoned: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as AbandonedData[]));
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

export interface AbandonedCheckoutDetail {
  checkout_id: number;
  source_checkout_id: string;
  created_at: string;
  total_amount: number;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_state: string | null;
  products: Array<{ name: string; quantity: number; price: number }> | null;
}

/** Individual abandoned checkouts with contact details, filtered by period */
export async function fetchAbandonedDetails(days: number = 30, from?: string, to?: string, limit: number = 20): Promise<AbandonedCheckoutDetail[]> {
  const supabase = getSupabase();
  const sinceStr = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]!; })();

  let query = supabase
    .from('abandoned_checkouts')
    .select('checkout_id, source_checkout_id, created_at, total_amount, contact_name, contact_email, contact_phone, contact_state, products')
    .order('created_at', { ascending: false })
    .gte('created_at', toSPTimestamp(sinceStr))
    .limit(limit);

  if (to) {
    query = query.lte('created_at', toSPTimestamp(to));
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetchAbandonedDetails: ${error.message}`);
  return (data ?? []) as AbandonedCheckoutDetail[];
}
