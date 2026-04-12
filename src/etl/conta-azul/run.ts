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
import { createSupabaseAdmin } from '../../lib/supabase.ts';
import { syncContaAzul } from './sync.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function updateEnvFile(newRefreshToken: string): void {
  const envPath = path.resolve('.env.local');
  let content = fs.readFileSync(envPath, 'utf-8');
  content = content.replace(
    /^CONTA_AZUL_REFRESH_TOKEN=.+$/m,
    `CONTA_AZUL_REFRESH_TOKEN=${newRefreshToken}`,
  );
  fs.writeFileSync(envPath, content, 'utf-8');
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
  console.log('========================================\n');

  const result = await syncContaAzul(
    supabase,
    {
      clientId: requireEnv('CONTA_AZUL_CLIENT_ID'),
      clientSecret: requireEnv('CONTA_AZUL_CLIENT_SECRET'),
      refreshToken: requireEnv('CONTA_AZUL_REFRESH_TOKEN'),
      onRefreshTokenRotated: (newToken) => {
        updateEnvFile(newToken);
      },
    },
    dataInicial,
    dataFinal,
    (msg) => console.log(msg),
  );

  console.log('\n========================================');
  console.log('SYNC COMPLETE');
  console.log('========================================');
  console.log(`  NF-e fetched:    ${result.nfeFetched}`);
  console.log(`  NF-e parsed:     ${result.nfeParsed}`);
  console.log(`  Customers:       ${result.customersUpserted}`);
  console.log(`  Sales:           ${result.salesUpserted}`);
  console.log(`  Sale items:      ${result.saleItemsInserted}`);
  console.log(`  Errors:          ${result.errors}`);
  console.log(`  Duration:        ${(result.durationMs / 1000).toFixed(1)}s`);

  if (result.errors > 0) {
    console.error(`\n⚠ ${result.errors} errors occurred.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
