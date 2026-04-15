/**
 * CLI runner for Conta Azul → Supabase sync.
 *
 * Usage:
 *   npx tsx --env-file=.env.local src/etl/conta-azul/run.ts           # incremental (auto)
 *   npx tsx --env-file=.env.local src/etl/conta-azul/run.ts --full    # force full (30 days)
 *   npx tsx --env-file=.env.local src/etl/conta-azul/run.ts --days 90 # full with custom window
 *
 * Incremental mode (default when data exists):
 *   - Queries the latest sale_date from sales WHERE source='conta_azul'
 *   - Syncs from (latest - 3 days) to today
 *   - 3 days margin because Conta Azul NF-e can be emitted retroactively
 *
 * ⚠ The refresh_token is SINGLE-USE. Each run rotates it and writes
 *   the new one to .env.local automatically.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '../../lib/supabase.ts';
import { syncContaAzul, cleanupOldNfeRecords } from './sync.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

/**
 * Try to update .env.local with the new refresh_token (works locally).
 * Silently fails in CI (file doesn't exist) — that's OK, Supabase
 * is the source of truth.
 */
function tryUpdateEnvFile(newRefreshToken: string): void {
  try {
    const envPath = path.resolve('.env.local');
    let content = fs.readFileSync(envPath, 'utf-8');
    content = content.replace(
      /^CONTA_AZUL_REFRESH_TOKEN=.+$/m,
      `CONTA_AZUL_REFRESH_TOKEN=${newRefreshToken}`,
    );
    fs.writeFileSync(envPath, content, 'utf-8');
  } catch {
    // In CI, .env.local doesn't exist — that's fine.
  }
}

/**
 * Read the refresh_token from Supabase etl_config table.
 * Falls back to env var if the table doesn't have it yet.
 */
async function getRefreshToken(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase
    .from('etl_config')
    .select('value')
    .eq('key', 'conta_azul_refresh_token')
    .limit(1);

  if (data !== null && data.length > 0 && data[0]?.value) {
    console.log('  📦 Refresh token loaded from Supabase etl_config');
    return data[0].value as string;
  }

  // Fallback to env var (first run or table not populated yet)
  const envToken = process.env.CONTA_AZUL_REFRESH_TOKEN;
  if (envToken) {
    console.log('  📦 Refresh token loaded from env var (fallback)');
    return envToken;
  }

  throw new Error('No refresh_token found in Supabase etl_config or env vars');
}

/**
 * Save the new refresh_token to Supabase etl_config table.
 * This is the source of truth for CI environments.
 */
async function saveRefreshToken(supabase: SupabaseClient, newToken: string): Promise<void> {
  const { error } = await supabase
    .from('etl_config')
    .upsert(
      { key: 'conta_azul_refresh_token', value: newToken, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );

  if (error !== null) {
    // CRITICAL: rethrow — the old token is already consumed (single-use).
    // If we swallow this, the next run will fail permanently.
    throw new Error(`Failed to save refresh_token to Supabase: ${error.message}`);
  }
  console.log('  ✅ Refresh token saved to Supabase etl_config');
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

async function main(): Promise<void> {
  const supabase = createSupabaseAdmin({
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });

  const isForceFull = process.argv.includes('--full');
  const daysArgIdx = process.argv.indexOf('--days');
  const customDays = daysArgIdx !== -1 ? Number(process.argv[daysArgIdx + 1]) : null;

  let dataInicial: string;
  let dataFinal: string;
  let mode: string;

  const now = new Date();
  dataFinal = formatDate(now);

  const isMigrate = process.argv.includes('--migrate');

  if (isForceFull || customDays !== null) {
    // Full sync mode
    const days = customDays ?? 30;
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    dataInicial = formatDate(since);
    mode = `FULL (${days} dias)`;
  } else {
    // Auto-detect: check for existing Conta Azul sales
    const { data } = await supabase
      .from('sales')
      .select('sale_date')
      .eq('source', 'conta_azul')
      .order('sale_date', { ascending: false })
      .limit(1);

    if (data !== null && data.length > 0 && data[0]?.sale_date) {
      // Incremental: from (last sale - 3 days) to today
      const lastSale = new Date(data[0].sale_date as string);
      const margin = new Date(lastSale.getTime() - 3 * 24 * 60 * 60 * 1000);
      dataInicial = formatDate(margin);
      mode = `INCREMENTAL (desde ${dataInicial})`;
    } else {
      // No existing data → full 30 days
      const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      dataInicial = formatDate(since);
      mode = 'FULL (30 dias — primeiro sync)';
    }
  }

  console.log('========================================');
  console.log(`Conta Azul → Supabase ${mode}`);
  console.log(`Período: ${dataInicial} → ${dataFinal}`);
  if (!isForceFull && customDays === null) {
    console.log('(use --full ou --days N para forçar sync completo)');
  }
  if (isMigrate) {
    console.log('⚠ --migrate: will clean up old NF-e records before sync');
  }
  console.log('========================================\n');

  // Read refresh_token from Supabase (source of truth) with env fallback
  const refreshToken = await getRefreshToken(supabase);

  // Clean up old NF-e records if migrating to venda-based sync
  if (isMigrate) {
    const cleanup = await cleanupOldNfeRecords(supabase, (msg) => console.log(msg));
    console.log(`  Migration: removed ${cleanup.salesDeleted} NF-e sales + ${cleanup.itemsDeleted} items\n`);
  }

  const result = await syncContaAzul(
    supabase,
    {
      clientId: requireEnv('CONTA_AZUL_CLIENT_ID'),
      clientSecret: requireEnv('CONTA_AZUL_CLIENT_SECRET'),
      refreshToken,
      onRefreshTokenRotated: async (newToken) => {
        // Save to Supabase (source of truth for CI/cron)
        await saveRefreshToken(supabase, newToken);
        // Also try to update .env.local (convenience for local dev)
        tryUpdateEnvFile(newToken);
      },
    },
    dataInicial,
    dataFinal,
    (msg) => console.log(msg),
  );

  console.log('\n========================================');
  console.log('SYNC COMPLETE');
  console.log('========================================');
  console.log(`  Vendas fetched:     ${result.vendasFetched}`);
  console.log(`  Vendas processed:   ${result.vendasProcessed}`);
  console.log(`  Skipped (NS):       ${result.vendasSkippedNuvemshop}`);
  console.log(`  Customers:          ${result.customersUpserted}`);
  console.log(`  Sales:              ${result.salesUpserted}`);
  console.log(`  Sale items:         ${result.saleItemsInserted}`);
  console.log(`  Errors:             ${result.errors}`);
  console.log(`  Duration:           ${(result.durationMs / 1000).toFixed(1)}s`);

  if (result.errors > 0) {
    console.error(`\n⚠ ${result.errors} errors occurred.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
