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

/** Visão Geral: revenue by day and source (last N days) */
export async function fetchDailyRevenue(days: number = 30): Promise<DailyRevenue[]> {
  const supabase = getSupabase();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('v_visao_geral_daily')
    .select('day, source, orders_count, gross_revenue')
    .gte('day', since.toISOString().split('T')[0]!)
    .order('day', { ascending: true });

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
export async function fetchNuvemshopDaily(days: number = 30): Promise<NuvemshopDaily[]> {
  const supabase = getSupabase();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('v_nuvemshop_daily')
    .select('*')
    .gte('day', since.toISOString().split('T')[0]!)
    .order('day', { ascending: true });

  if (error) throw new Error(`fetchNuvemshopDaily: ${error.message}`);
  return (data ?? []) as NuvemshopDaily[];
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
