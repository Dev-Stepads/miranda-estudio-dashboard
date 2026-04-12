/**
 * CLI runner for Nuvemshop → Supabase full sync.
 *
 * Usage:
 *   npx tsx src/etl/nuvemshop/run.ts
 *
 * Reads config from .env.local (pass via --env-file or dotenv).
 * Syncs in order: customers → orders (sales + sale_items) → checkouts.
 *
 * ⚠ This is a FULL SYNC. It pulls ALL pages from the Nuvemshop API
 *    and upserts into canonical tables. For 5925 orders + 4910 customers
 *    + 42 checkouts (Miranda's current size), it takes ~30-60 seconds
 *    respecting the 40/2rps rate limit.
 *
 * ⚠ The seed data in Supabase will be OVERWRITTEN by real data via
 *    the upsert. Sale items from the seed will be replaced. This is
 *    expected — the seed was for development only.
 */

import { NuvemshopClient } from '../../integrations/nuvemshop/client.ts';
import { createSupabaseAdmin } from '../../lib/supabase.ts';
import { syncCustomers, syncProducts, syncOrders, linkSaleItemProducts, syncAbandonedCheckouts, type SyncContext } from './sync.ts';

// ------------------------------------------------------------
// Read env (hard fail if any is missing)
// ------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}. Check your .env.local.`);
  }
  return value;
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

/**
 * Auto-detect sync mode:
 * - If sales table has Nuvemshop data → incremental (last sale_date - 24h)
 * - If empty → full sync
 * - Override with --full flag to force full sync
 */
async function detectSyncSince(
  supabase: import('@supabase/supabase-js').SupabaseClient,
): Promise<string | null> {
  // Force full sync with --full flag
  if (process.argv.includes('--full')) {
    console.log('⚠ --full flag detected: forcing full sync\n');
    return null;
  }

  const { data, error } = await supabase
    .from('sales')
    .select('sale_date')
    .eq('source', 'nuvemshop')
    .order('sale_date', { ascending: false })
    .limit(1);

  if (error !== null || data === null || data.length === 0) {
    return null; // No existing data → full sync
  }

  const lastSaleDate = new Date(data[0]!.sale_date as string);
  // Subtract 24h safety margin for timezone/processing delays
  const since = new Date(lastSaleDate.getTime() - 24 * 60 * 60 * 1000);
  return since.toISOString();
}

async function main(): Promise<void> {
  const startTotal = Date.now();

  // Build clients
  const nuvemshop = new NuvemshopClient({
    accessToken: requireEnv('NUVEMSHOP_ACCESS_TOKEN'),
    storeId: Number(requireEnv('NUVEMSHOP_STORE_ID')),
    userAgent: requireEnv('NUVEMSHOP_USER_AGENT'),
  });

  const supabase = createSupabaseAdmin({
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  });

  // Auto-detect sync mode
  const since = await detectSyncSince(supabase);
  const mode = since !== null ? 'INCREMENTAL' : 'FULL';

  console.log('========================================');
  console.log(`Nuvemshop → Supabase ${mode} Sync`);
  if (since !== null) {
    console.log(`Since: ${since}`);
    console.log('(use --full flag to force full sync)');
  }
  console.log('========================================');
  console.log('');

  const ctx: SyncContext = {
    nuvemshop,
    supabase,
    customerLookup: new Map(),
    since,
    log: (msg) => console.log(msg),
  };

  // Sync in order (FK dependencies: customers → products → sales → link → checkouts)
  const results = [];

  // 1. Customers (incremental: only new/updated since last sync)
  results.push(await syncCustomers(ctx));
  console.log(`  → Customer lookup map: ${ctx.customerLookup.size} entries\n`);

  // 2. Products — only in full sync (catalog changes rarely)
  if (since === null) {
    results.push(await syncProducts(ctx));
    console.log('');
  } else {
    console.log('⏭ Products skipped (incremental mode — run with --full to resync catalog)\n');
  }

  // 3. Orders → sales + sale_items
  results.push(await syncOrders(ctx));
  console.log('');

  // 4. Link sale_items → products — only in full sync
  if (since === null) {
    results.push(await linkSaleItemProducts(ctx));
    console.log('');
  }

  // 5. Abandoned checkouts — always full (only ~40-50 items, trivial)
  results.push(await syncAbandonedCheckouts(ctx));

  // Summary
  const totalMs = Date.now() - startTotal;
  console.log('\n========================================');
  console.log('SYNC COMPLETE');
  console.log('========================================');
  for (const r of results) {
    console.log(`  ${r.resource}: ${r.inserted} synced, ${r.errors} errors, ${r.durationMs}ms`);
  }
  console.log(`  TOTAL: ${totalMs}ms`);

  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  if (totalErrors > 0) {
    console.error(`\n⚠ ${totalErrors} errors occurred. Check logs above.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
