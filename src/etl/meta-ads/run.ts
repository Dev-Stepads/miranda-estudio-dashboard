/**
 * CLI runner for Meta Ads → Supabase sync.
 *
 * Usage:
 *   npm run sync:meta-ads            # incremental: últimos 7 dias (upsert defensivo)
 *   npm run sync:meta-ads:full       # full sync: últimos 90 dias
 *   npx tsx src/etl/meta-ads/run.ts --days 30
 *
 * Comportamento:
 *   - Modo default (incremental) = janela de 7 dias terminando HOJE.
 *     Isso implementa a decisão D4 do MAPEAMENTO_META_ADS: Meta recalcula
 *     dados historicos por ate 7 dias, entao sempre retornamos essa janela
 *     e fazemos UPSERT pra refletir eventuais mudanças.
 *   - Modo --full ou --days N = janela de N dias (90 por default em --full).
 *     Usar no primeiro sync ou pra reprocessar histórico.
 */

import { MetaAdsClient } from '../../integrations/meta-ads/client.ts';
import { createSupabaseAdmin } from '../../lib/supabase.ts';
import { syncMetaAds, type MetaSyncContext } from './sync.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}. Check your .env.local.`);
  }
  return value;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const startTotal = Date.now();

  // ---- Parse args ----
  const isFull = process.argv.includes('--full');
  const daysArgIdx = process.argv.indexOf('--days');
  const customDays =
    daysArgIdx !== -1 ? Number(process.argv[daysArgIdx + 1]) : null;

  const days = customDays !== null ? customDays : isFull ? 90 : 7;
  const mode =
    customDays !== null
      ? `CUSTOM (${customDays} dias)`
      : isFull
        ? 'FULL (90 dias)'
        : 'INCREMENTAL (7 dias — upsert defensivo)';

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  console.log('========================================');
  console.log(`Meta Ads → Supabase ${mode}`);
  console.log(`Período: ${formatDate(since)} → ${formatDate(now)}`);
  if (!isFull && customDays === null) {
    console.log('(use --full ou --days N para janela maior)');
  }
  console.log('========================================\n');

  // ---- Build clients ----
  const meta = new MetaAdsClient({
    accessToken: requireEnv('META_SYSTEM_USER_TOKEN'),
    adAccountId: requireEnv('META_AD_ACCOUNT_ID'),
    apiVersion: process.env.META_API_VERSION ?? 'v25.0',
  });

  const supabase = createSupabaseAdmin({
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });

  // ---- Run sync ----
  const ctx: MetaSyncContext = {
    meta,
    supabase,
    since: formatDate(since),
    until: formatDate(now),
    log: (msg) => console.log(msg),
  };

  const results = await syncMetaAds(ctx);

  // ---- Summary ----
  const totalMs = Date.now() - startTotal;
  console.log('\n========================================');
  console.log('SYNC COMPLETE');
  console.log('========================================');
  for (const r of results) {
    console.log(
      `  ${r.level}: ${r.rowsUpserted} upserted, ${r.errors} errors, ` +
        `${r.windowsProcessed} window(s), ${r.durationMs}ms`,
    );
  }
  console.log(`  TOTAL: ${totalMs}ms`);

  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  if (totalErrors > 0) {
    console.error(`\n⚠ ${totalErrors} errors. Check logs above.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
