/**
 * Meta Ads → Supabase ETL sync.
 *
 * Flow per run:
 *   1. For each level (campaign → adset → ad), fetch insights with
 *      time_increment=1 (daily) over the requested window.
 *   2. Map each raw row to canonical shape (spend as number, purchases
 *      extracted from actions[]).
 *   3. Upsert into `meta_ads_insights` with conflict on
 *      (date, level, campaign_id, coalesce(adset_id,''), coalesce(ad_id,''))
 *      — this is the unique index already defined in the initial schema.
 *   4. Append raw payloads to `raw_meta_insights_*` for history.
 *
 * Defensive reprocessing window (decisão D4 no MAPEAMENTO_META_ADS.txt):
 *   Every run — incremental OR full — pulls AT LEAST the last 7 days and
 *   UPSERTs. Meta recalcula métricas por até 7 dias depois do evento
 *   (conversões assíncronas, ajustes de atribuição), então reler + upsert
 *   é a forma canônica de ficar em dia sem estado local.
 *
 * Full sync chunking:
 *   Para períodos grandes (ex: 1 ano), o endpoint /insights pode dar
 *   timeout. Quebramos em janelas mensais (ver decisão D4 doc §4.3).
 *
 * Erro tolerance:
 *   Se uma janela falha, logamos e seguimos com a próxima — o próximo run
 *   da cron pega o gap (é idempotente).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { MetaAdsClient } from '../../integrations/meta-ads/client.ts';
import { mapInsightToCanonical } from '../../integrations/meta-ads/mapper.ts';
import type {
  MetaInsightsRow,
  CanonicalMetaInsight,
} from '../../integrations/meta-ads/types.ts';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface MetaSyncContext {
  meta: MetaAdsClient;
  supabase: SupabaseClient;
  /** YYYY-MM-DD, inclusive. */
  since: string;
  /** YYYY-MM-DD, inclusive. */
  until: string;
  log: (msg: string) => void;
}

export interface MetaSyncResult {
  level: 'campaign' | 'adset' | 'ad';
  rowsFetched: number;
  rowsUpserted: number;
  windowsProcessed: number;
  errors: number;
  durationMs: number;
}

// ------------------------------------------------------------
// Window chunking — 1 month max per request
// ------------------------------------------------------------

const CHUNK_DAYS = 30;

interface Window {
  since: string;
  until: string;
}

function chunkWindows(since: string, until: string): Window[] {
  const windows: Window[] = [];
  const sinceDate = new Date(`${since}T00:00:00Z`);
  const untilDate = new Date(`${until}T00:00:00Z`);

  let cursor = sinceDate;
  while (cursor <= untilDate) {
    const end = new Date(
      Math.min(
        cursor.getTime() + CHUNK_DAYS * 24 * 60 * 60 * 1000,
        untilDate.getTime(),
      ),
    );
    windows.push({
      since: formatDate(cursor),
      until: formatDate(end),
    });
    cursor = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }

  return windows;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// Level sync — reused for campaign/adset/ad
// ------------------------------------------------------------

async function syncLevel(
  ctx: MetaSyncContext,
  level: 'campaign' | 'adset' | 'ad',
): Promise<MetaSyncResult> {
  const start = Date.now();
  let rowsFetched = 0;
  let rowsUpserted = 0;
  let errors = 0;

  const windows = chunkWindows(ctx.since, ctx.until);
  ctx.log(
    `🔄 Meta Ads insights [${level}] — ${ctx.since}→${ctx.until} ` +
      `(${windows.length} window${windows.length === 1 ? '' : 's'})`,
  );

  const allRaw: MetaInsightsRow[] = [];

  for (const window of windows) {
    try {
      const result = await ctx.meta.listInsights(
        {
          level,
          since: window.since,
          until: window.until,
          timeIncrement: 1,
          limit: 500,
        },
        (msg) => ctx.log(msg),
      );
      rowsFetched += result.items.length;
      allRaw.push(...result.items);
    } catch (err) {
      ctx.log(
        `  ❌ [${level}] ${window.since}→${window.until}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      errors++;
    }
  }

  // Map → canonical
  const canonical: CanonicalMetaInsight[] = [];
  for (const raw of allRaw) {
    const mapped = mapInsightToCanonical(raw, level);
    if (mapped !== null) canonical.push(mapped);
  }

  ctx.log(`  mapped ${canonical.length}/${rowsFetched} rows (level=${level})`);

  // Upsert em batches de 500.
  //
  // Conflict target: o constraint `uq_meta_insights` nas colunas simples
  // (date, level, campaign_id, adset_id, ad_id). O schema foi ajustado na
  // migration 20260413120000 pra usar constraint em vez de expression
  // index — ver comentario la pro porque.
  //
  // Nulls em adset_id/ad_id viram '' no boundary, porque as colunas sao
  // NOT NULL DEFAULT ''. Semantica: '' = "nao aplicavel pro nivel"
  // (campaign rows tem adset_id='' e ad_id='').
  const BATCH_SIZE = 500;
  for (let i = 0; i < canonical.length; i += BATCH_SIZE) {
    const batch = canonical.slice(i, i + BATCH_SIZE).map((row) => ({
      date: row.date,
      level: row.level,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      adset_id: row.adset_id ?? '',
      adset_name: row.adset_name,
      ad_id: row.ad_id ?? '',
      ad_name: row.ad_name,
      spend: row.spend,
      impressions: row.impressions,
      reach: row.reach,
      clicks: row.clicks,
      purchases: row.purchases,
      purchase_value: row.purchase_value,
    }));

    // Supabase upsert onConflict with expression index: we must name the
    // columns in the same order as the index. Nulls in adset_id/ad_id are
    // fine because the expression uses coalesce(col,'') — Postgres treats
    // this as a unique tuple.
    const { error } = await ctx.supabase
      .from('meta_ads_insights')
      .upsert(batch, {
        onConflict: 'date,level,campaign_id,adset_id,ad_id',
      });

    if (error !== null) {
      ctx.log(`  ❌ [${level}] upsert batch ${i / BATCH_SIZE + 1}: ${error.message}`);
      errors++;
      continue;
    }

    rowsUpserted += batch.length;
  }

  // Append raw payloads for history (append-only, no dedup)
  const rawTable =
    level === 'campaign'
      ? 'raw_meta_insights_campaign'
      : level === 'adset'
        ? 'raw_meta_insights_adset'
        : 'raw_meta_insights_ad';
  const entityIdCol =
    level === 'campaign' ? 'campaign_id' : level === 'adset' ? 'adset_id' : 'ad_id';

  if (allRaw.length > 0) {
    const rawPayloads = allRaw.map((row) => ({
      date_start: row.date_start,
      [entityIdCol]: row[entityIdCol as keyof MetaInsightsRow] ?? null,
      payload: row as unknown as Record<string, unknown>,
    }));

    // Insert in chunks of 500 as well
    for (let i = 0; i < rawPayloads.length; i += BATCH_SIZE) {
      const batch = rawPayloads.slice(i, i + BATCH_SIZE);
      await ctx.supabase.from(rawTable).insert(batch);
    }
  }

  const durationMs = Date.now() - start;
  ctx.log(
    `✅ [${level}] done — ${rowsUpserted} upserted, ${errors} errors, ${durationMs}ms`,
  );

  return {
    level,
    rowsFetched,
    rowsUpserted,
    windowsProcessed: windows.length,
    errors,
    durationMs,
  };
}

// ------------------------------------------------------------
// Public entrypoint
// ------------------------------------------------------------

export async function syncMetaAds(
  ctx: MetaSyncContext,
): Promise<MetaSyncResult[]> {
  // Validate credentials first — fail fast if the token is bad
  ctx.log('🔍 Validating Meta Ads credentials...');
  const account = await ctx.meta.getAdAccount();
  ctx.log(
    `  ✅ Account: ${account.name ?? account.id} ` +
      `(status=${account.account_status}, currency=${account.currency ?? '?'})`,
  );
  if (account.business?.id !== undefined) {
    ctx.log(`  ✅ Business: ${account.business.name ?? account.business.id}`);
  }

  const results: MetaSyncResult[] = [];

  // Order matters: campaign first (smallest), then adset, then ad (biggest).
  // See doc §10 INGESTÃO COMPLETA HISTÓRICA.
  // 'account' level is NOT stored — we aggregate in the v_meta_account_daily view.
  const levels = ['campaign', 'adset', 'ad'] as const;
  for (const level of levels) {
    results.push(await syncLevel(ctx, level));
  }

  // Cleanup raw tables — retain only last 90 days to prevent unbounded growth.
  // With cron every 30 min, raw tables grow ~11k rows/day without cleanup.
  await cleanupRawTables(ctx);

  return results;
}

// ------------------------------------------------------------
// Raw table retention — delete rows older than 90 days
// ------------------------------------------------------------

const RAW_RETENTION_DAYS = 90;

async function cleanupRawTables(ctx: MetaSyncContext): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RAW_RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0]!;

  const tables = [
    'raw_meta_insights_campaign',
    'raw_meta_insights_adset',
    'raw_meta_insights_ad',
  ];

  for (const table of tables) {
    const { count, error } = await ctx.supabase
      .from(table)
      .delete({ count: 'exact' })
      .lt('date_start', cutoffStr);

    if (error) {
      ctx.log(`  ⚠ cleanup ${table}: ${error.message}`);
    } else if (count && count > 0) {
      ctx.log(`  🧹 ${table}: deleted ${count} rows older than ${cutoffStr}`);
    }
  }
}
