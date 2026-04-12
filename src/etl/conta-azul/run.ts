/**
 * CLI runner for Conta Azul → Supabase sync.
 *
 * Usage:
 *   npx tsx --env-file=.env.local src/etl/conta-azul/run.ts
 *   npx tsx --env-file=.env.local src/etl/conta-azul/run.ts --days 90
 *
 * Default: syncs last 30 days of NF-e.
 * The --days flag controls the lookback window.
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

async function main(): Promise<void> {
  // Parse --days flag (default 30)
  const daysArg = process.argv.find(a => a.startsWith('--days'));
  const daysValue = process.argv[process.argv.indexOf('--days') + 1];
  const days = daysArg && daysValue ? Number(daysValue) : 30;

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const dataInicial = since.toISOString().split('T')[0]!;
  const dataFinal = now.toISOString().split('T')[0]!;

  console.log('========================================');
  console.log('Conta Azul → Supabase Sync');
  console.log(`Período: ${dataInicial} → ${dataFinal} (${days} dias)`);
  console.log('========================================\n');

  const supabase = createSupabaseAdmin({
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });

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
    console.error(`\n⚠ ${result.errors} errors occurred. Check logs above.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
