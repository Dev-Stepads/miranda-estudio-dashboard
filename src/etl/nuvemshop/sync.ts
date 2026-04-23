/**
 * Nuvemshop → Supabase ETL sync.
 *
 * This module contains the full-sync functions that:
 * 1. Paginate through the Nuvemshop API via NuvemshopClient
 * 2. Map raw responses to canonical shapes
 * 3. Upsert into canonical Supabase tables
 * 4. Insert raw payloads into raw_nuvemshop_* tables for history
 *
 * Ordering constraint: customers MUST be synced BEFORE orders because
 * sales.customer_id is a FK to customers.customer_id.
 *
 * Gender mapping at DB boundary:
 *   canonical 'male'   → DB 'M'
 *   canonical 'female' → DB 'F'
 *   canonical 'other'  → DB 'unknown'  (DB schema has no 'other' value)
 *   canonical 'unknown'→ DB 'unknown'
 *
 * This is a FULL SYNC (pulls all pages). Incremental sync (created_at_min)
 * will be added when the scheduler (T48) is implemented.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { NuvemshopClient } from '../../integrations/nuvemshop/client.ts';
import {
  mapOrderToCanonicalSale,
  mapCustomerToCanonical,
  mapCheckoutToCanonicalAbandoned,
} from '../../integrations/nuvemshop/mapper.ts';
import type { RawNuvemshopOrder, RawNuvemshopCustomer, RawNuvemshopProduct, RawNuvemshopCheckout } from '../../integrations/nuvemshop/types.ts';
import type { Gender } from '../../canonical/types.ts';
import { extractLocalized } from '../../lib/i18n.ts';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface SyncResult {
  resource: string;
  inserted: number;
  updated: number;
  errors: number;
  durationMs: number;
}

export interface SyncContext {
  nuvemshop: NuvemshopClient;
  supabase: SupabaseClient;
  /** Map of Nuvemshop customer ID (string) → Supabase customer_id (bigint) */
  customerLookup: Map<string, number>;
  /**
   * ISO date string for incremental sync. If set, only pull records
   * created/updated after this date. Null = full sync.
   */
  since: string | null;
  log: (message: string) => void;
}

// ------------------------------------------------------------
// Gender boundary conversion (canonical → DB CHECK constraint)
// ------------------------------------------------------------

function genderToDb(gender: Gender): string {
  switch (gender) {
    case 'male': return 'M';
    case 'female': return 'F';
    case 'other': return 'unknown';
    case 'unknown': return 'unknown';
  }
}

// ------------------------------------------------------------
// Rate-limit aware pagination helper
// ------------------------------------------------------------

const PAGE_SIZE = 200;
const RATE_LIMIT_THRESHOLD = 5;
const RATE_LIMIT_COOLDOWN_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Paginate through ALL pages of a Nuvemshop list endpoint.
 * Pauses when rate limit is close to exhaustion.
 */
const MAX_PAGES = 500; // safety limit to prevent infinite loops

async function paginateAll<T>(
  fetcher: (page: number) => Promise<{ items: T[]; pagination: { nextUrl: string | null }; rateLimit: { remaining: number } }>,
  log: (msg: string) => void,
): Promise<T[]> {
  const allItems: T[] = [];
  let page = 1;

  while (true) {
    const result = await fetcher(page);
    allItems.push(...result.items);

    log(`  page ${page}: ${result.items.length} items (total so far: ${allItems.length}, rate remaining: ${result.rateLimit.remaining})`);

    if (result.pagination.nextUrl === null || result.items.length === 0) {
      break;
    }

    if (page >= MAX_PAGES) {
      log(`  ⚠ Hit max page limit (${MAX_PAGES}), stopping pagination`);
      break;
    }

    if (result.rateLimit.remaining <= RATE_LIMIT_THRESHOLD) {
      log(`  ⏸ rate limit low (${result.rateLimit.remaining}), cooling down ${RATE_LIMIT_COOLDOWN_MS}ms...`);
      await sleep(RATE_LIMIT_COOLDOWN_MS);
    }

    page++;
  }

  return allItems;
}

// ------------------------------------------------------------
// 1. Sync Customers
// ------------------------------------------------------------

export async function syncCustomers(ctx: SyncContext): Promise<SyncResult> {
  const start = Date.now();
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  const mode = ctx.since !== null ? `incremental (since ${ctx.since})` : 'full';
  ctx.log(`🔄 Syncing Nuvemshop customers [${mode}]...`);

  // 1. Paginate customers (incremental uses created_at_min)
  const rawCustomers = await paginateAll<RawNuvemshopCustomer>(
    (page) => ctx.nuvemshop.listCustomers({
      page,
      perPage: PAGE_SIZE,
      ...(ctx.since !== null ? { since: ctx.since } : {}),
    }),
    ctx.log,
  );
  ctx.log(`  Total customers fetched: ${rawCustomers.length}`);

  // Pre-load ALL existing customers from DB (Supabase limits to 1000/query, so paginate)
  let preloadPage = 0;
  const PRELOAD_SIZE = 1000;
  let preloadTotal = 0;

  while (true) {
    const { data: batch } = await ctx.supabase
      .from('customers')
      .select('customer_id, source_customer_id')
      .eq('source', 'nuvemshop')
      .range(preloadPage * PRELOAD_SIZE, (preloadPage + 1) * PRELOAD_SIZE - 1);

    if (batch === null || batch.length === 0) break;

    for (const row of batch) {
      ctx.customerLookup.set(
        String(row.source_customer_id),
        row.customer_id as number,
      );
    }
    preloadTotal += batch.length;
    if (batch.length < PRELOAD_SIZE) break;
    preloadPage++;
  }

  ctx.log(`  Pre-loaded ${preloadTotal} existing customers into lookup (${ctx.customerLookup.size} unique)`);

  // 2. Map + upsert in batches
  const BATCH_SIZE = 100;
  for (let i = 0; i < rawCustomers.length; i += BATCH_SIZE) {
    const batch = rawCustomers.slice(i, i + BATCH_SIZE);
    const mapped = batch.map((raw) => {
      const canonical = mapCustomerToCanonical(raw);
      return {
        source: canonical.source,
        source_customer_id: canonical.source_id,
        name: canonical.name,
        gender: genderToDb(canonical.gender),
        age: canonical.age,
        age_range: canonical.age_range,
        state: canonical.state,
        city: canonical.city,
        email: canonical.email,
        phone: canonical.phone,
      };
    });

    const { data, error } = await ctx.supabase
      .from('customers')
      .upsert(mapped, { onConflict: 'source,source_customer_id' })
      .select('customer_id, source_customer_id');

    if (error !== null) {
      ctx.log(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${error.message}`);
      errors += batch.length;
      continue;
    }

    // Build lookup map for FK resolution
    if (data !== null) {
      for (const row of data) {
        ctx.customerLookup.set(
          String(row.source_customer_id),
          row.customer_id as number,
        );
      }
      // Count inserts vs updates (approximate: if total rows == batch size, some may be updates)
      inserted += data.length;
    }

    // 3. Insert raw payloads for history
    const rawPayloads = batch.map((raw) => ({
      source_id: String(raw.id),
      payload: raw as unknown as Record<string, unknown>,
    }));
    const { error: rawErr } = await ctx.supabase.from('raw_nuvemshop_customers').upsert(rawPayloads, { onConflict: 'source_id' });
    if (rawErr) {
      ctx.log(`  ⚠ raw_nuvemshop_customers: ${rawErr.message}`);
      errors++;
    }
  }

  const durationMs = Date.now() - start;
  ctx.log(`✅ Customers synced: ${inserted} rows, ${errors} errors, ${durationMs}ms`);
  return { resource: 'customers', inserted, updated, errors, durationMs };
}

// ------------------------------------------------------------
// 2. Sync Orders (sales + sale_items) — BATCHED for performance
// ------------------------------------------------------------

export async function syncOrders(ctx: SyncContext): Promise<SyncResult> {
  const start = Date.now();
  let inserted = 0;
  let errors = 0;

  const mode = ctx.since !== null ? `incremental (since ${ctx.since})` : 'full';
  ctx.log(`🔄 Syncing Nuvemshop orders → sales + sale_items [${mode}]...`);

  // 1. Paginate orders from API (incremental uses created_at_min)
  const rawOrders = await paginateAll<RawNuvemshopOrder>(
    (page) => ctx.nuvemshop.listOrders({
      page,
      perPage: PAGE_SIZE,
      ...(ctx.since !== null ? { since: ctx.since } : {}),
    }),
    ctx.log,
  );
  ctx.log(`  Total orders fetched: ${rawOrders.length}`);

  // 2. Map all orders to canonical shapes + resolve customer FKs
  const mappedOrders = rawOrders.map((raw) => {
    const canonical = mapOrderToCanonicalSale(raw);
    const customerId = canonical.customer_source_id !== null
      ? ctx.customerLookup.get(canonical.customer_source_id) ?? null
      : null;
    return { raw, canonical, customerId };
  });

  // 3. Process in batches of BATCH_SIZE
  const BATCH_SIZE = 100;
  for (let i = 0; i < mappedOrders.length; i += BATCH_SIZE) {
    const batch = mappedOrders.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(mappedOrders.length / BATCH_SIZE);

    try {
      // 3a. Batch upsert sales
      const salesToUpsert = batch.map(({ canonical, customerId }) => ({
        source: canonical.source,
        source_sale_id: canonical.source_id,
        sale_date: canonical.sale_date,
        gross_revenue: canonical.total_gross,
        net_revenue: canonical.total_net,
        status: canonical.status,
        customer_id: customerId,
        payment_method: canonical.payment_method,
      }));

      const { data: saleData, error: saleError } = await ctx.supabase
        .from('sales')
        .upsert(salesToUpsert, { onConflict: 'source,source_sale_id' })
        .select('sale_id, source_sale_id');

      if (saleError !== null) {
        ctx.log(`  ❌ Batch ${batchNum}/${totalBatches} sales upsert: ${saleError.message}`);
        errors += batch.length;
        continue;
      }

      // Build source_sale_id → sale_id map for this batch
      const saleIdMap = new Map<string, number>();
      if (saleData !== null) {
        for (const row of saleData) {
          saleIdMap.set(
            String(row.source_sale_id),
            row.sale_id as number,
          );
        }
      }

      // 3b. Delete old sale_items for all sales in this batch
      const saleIds = Array.from(saleIdMap.values());
      if (saleIds.length > 0) {
        await ctx.supabase
          .from('sale_items')
          .delete()
          .in('sale_id', saleIds);
      }

      // 3c. Batch insert new sale_items
      const allItems: Array<{
        sale_id: number;
        product_name: string;
        sku: string | null;
        quantity: number;
        unit_price: number;
        total_price: number;
      }> = [];

      for (const { canonical } of batch) {
        const saleId = saleIdMap.get(canonical.source_id);
        if (saleId === undefined) continue;
        const validItems = canonical.items.filter((item) => item.quantity > 0);
        if (validItems.length === 0) continue;

        // Distribute order-level discounts proportionally across items so that
        // sum(item.total_price) = gross_revenue. Without this, product rankings
        // show pre-discount revenue (inflated). See audit 2026-04-22.
        const rawSum = validItems.reduce((s, i) => s + i.total_price, 0);
        const gross = canonical.total_gross;
        const needsAdjust = rawSum > 0 && Math.abs(rawSum - gross) > 0.01;

        if (needsAdjust) {
          const adjustedPrices = validItems.map((item) =>
            Math.round((item.total_price / rawSum) * gross * 100) / 100,
          );
          // Last item absorbs rounding residual so sum matches gross exactly
          const partialSum = adjustedPrices.slice(0, -1).reduce((s, p) => s + p, 0);
          adjustedPrices[adjustedPrices.length - 1] = Math.round((gross - partialSum) * 100) / 100;

          for (let idx = 0; idx < validItems.length; idx++) {
            const item = validItems[idx]!;
            allItems.push({
              sale_id: saleId,
              product_name: item.product_name,
              sku: item.sku,
              quantity: item.quantity,
              unit_price: item.unit_price,
              total_price: adjustedPrices[idx]!,
            });
          }
        } else {
          for (const item of validItems) {
            allItems.push({
              sale_id: saleId,
              product_name: item.product_name,
              sku: item.sku,
              quantity: item.quantity,
              unit_price: item.unit_price,
              total_price: item.total_price,
            });
          }
        }
      }

      if (allItems.length > 0) {
        const { error: itemsError } = await ctx.supabase
          .from('sale_items')
          .insert(allItems);

        if (itemsError !== null) {
          ctx.log(`  ❌ Batch ${batchNum}/${totalBatches} sale_items insert: ${itemsError.message}`);
        }
      }

      // 3d. Batch insert raw payloads for history
      const rawPayloads = batch.map(({ raw }) => ({
        source_id: String(raw.id),
        payload: raw as unknown as Record<string, unknown>,
      }));
      const { error: rawOrdErr } = await ctx.supabase.from('raw_nuvemshop_orders').upsert(rawPayloads, { onConflict: 'source_id' });
      if (rawOrdErr) {
        ctx.log(`  ⚠ raw_nuvemshop_orders: ${rawOrdErr.message}`);
        errors++;
      }

      inserted += saleIdMap.size;
      ctx.log(`  batch ${batchNum}/${totalBatches}: ${saleIdMap.size} sales + ${allItems.length} items`);

    } catch (err) {
      ctx.log(`  ❌ Batch ${batchNum}/${totalBatches}: ${err instanceof Error ? err.message : String(err)}`);
      errors += batch.length;
    }
  }

  const durationMs = Date.now() - start;
  ctx.log(`✅ Orders synced: ${inserted} sales, ${errors} errors, ${durationMs}ms`);
  return { resource: 'orders', inserted, updated: 0, errors, durationMs };
}

// ------------------------------------------------------------
// 3. Sync Abandoned Checkouts
// ------------------------------------------------------------

export async function syncAbandonedCheckouts(ctx: SyncContext): Promise<SyncResult> {
  const start = Date.now();
  let inserted = 0;
  let errors = 0;

  ctx.log('🔄 Syncing Nuvemshop abandoned checkouts...');

  const rawCheckouts = await paginateAll<RawNuvemshopCheckout>(
    (page) => ctx.nuvemshop.listAbandonedCheckouts({ page, perPage: PAGE_SIZE }),
    ctx.log,
  );
  ctx.log(`  Total checkouts fetched: ${rawCheckouts.length}`);

  // Process in batches of 100 (matching orders/customers pattern)
  const CHECKOUT_BATCH = 100;
  for (let i = 0; i < rawCheckouts.length; i += CHECKOUT_BATCH) {
    const batch = rawCheckouts.slice(i, i + CHECKOUT_BATCH);

    const rows: Array<Record<string, unknown>> = [];
    const rawPayloads: Array<{ source_id: string; payload: Record<string, unknown> }> = [];

    for (const raw of batch) {
      try {
        const canonical = mapCheckoutToCanonicalAbandoned(raw);
        const customerId = canonical.customer_source_id !== null
          ? ctx.customerLookup.get(canonical.customer_source_id) ?? null
          : null;

        rows.push({
          source_checkout_id: canonical.source_id,
          created_at: canonical.abandoned_at,
          total_amount: canonical.total_value,
          customer_id: customerId,
          contact_name: canonical.contact_name,
          contact_email: canonical.contact_email,
          contact_phone: canonical.contact_phone,
          contact_state: canonical.contact_state,
          products: canonical.products,
        });

        rawPayloads.push({
          source_id: String(raw.id),
          payload: raw as unknown as Record<string, unknown>,
        });
      } catch (err) {
        ctx.log(`  ❌ Checkout ${raw.id}: ${err instanceof Error ? err.message : String(err)}`);
        errors++;
      }
    }

    if (rows.length > 0) {
      const { error } = await ctx.supabase
        .from('abandoned_checkouts')
        .upsert(rows, { onConflict: 'source_checkout_id' });
      if (error) {
        ctx.log(`  ❌ Checkout batch ${Math.floor(i / CHECKOUT_BATCH) + 1}: ${error.message}`);
        errors += rows.length;
      } else {
        inserted += rows.length;
      }
    }

    if (rawPayloads.length > 0) {
      const { error: rawAbErr } = await ctx.supabase
        .from('raw_nuvemshop_abandoned_checkouts')
        .upsert(rawPayloads, { onConflict: 'source_id' });
      if (rawAbErr) {
        ctx.log(`  ⚠ raw_nuvemshop_abandoned_checkouts: ${rawAbErr.message}`);
        errors++;
      }
    }
  }

  const durationMs = Date.now() - start;
  ctx.log(`✅ Checkouts synced: ${inserted} rows, ${errors} errors, ${durationMs}ms`);
  return { resource: 'abandoned_checkouts', inserted, updated: 0, errors, durationMs };
}

// ------------------------------------------------------------
// 4. Sync Products (populate products table from Nuvemshop catalog)
// ------------------------------------------------------------

/**
 * Syncs Nuvemshop products into the canonical `products` table.
 *
 * Each VARIANT with a non-null SKU becomes its own row in `products`
 * (because sale_items link by SKU, and SKU is at the variant level).
 * Products/variants without SKU are skipped (can't be linked anyway).
 *
 * Uses upsert by `sku` — the partial unique index on products(sku)
 * WHERE sku IS NOT NULL handles the conflict resolution.
 */
export async function syncProducts(ctx: SyncContext): Promise<SyncResult> {
  const start = Date.now();
  let inserted = 0;
  let errors = 0;

  ctx.log('🔄 Syncing Nuvemshop products → products table...');

  const rawProducts = await paginateAll<RawNuvemshopProduct>(
    (page) => ctx.nuvemshop.listProducts({ page, perPage: PAGE_SIZE }),
    ctx.log,
  );
  ctx.log(`  Total products fetched: ${rawProducts.length}`);

  // Collect all variants with SKUs
  const productRows: Array<{
    canonical_name: string;
    sku: string;
    source_refs: Record<string, string>;
  }> = [];

  for (const raw of rawProducts) {
    const productName = extractLocalized(raw.name, 'pt');
    const variants = raw.variants ?? [];

    if (variants.length === 0) {
      // No variants — skip (can't link to sale_items without SKU)
      continue;
    }

    for (const variant of variants) {
      if (variant.sku === null || variant.sku === undefined || variant.sku === '') continue;

      // Build a descriptive name including variant values if available
      const variantSuffix = variant.values
        ?.map(v => extractLocalized(v, 'pt'))
        .filter(v => v !== '')
        .join(' / ');
      const name = variantSuffix ? `${productName} (${variantSuffix})` : productName;

      productRows.push({
        canonical_name: name,
        sku: variant.sku,
        source_refs: { nuvemshop: String(raw.id) },
      });
    }
  }

  ctx.log(`  Variants with SKU: ${productRows.length}`);

  // Batch upsert by SKU
  const BATCH_SIZE = 100;
  for (let i = 0; i < productRows.length; i += BATCH_SIZE) {
    const batch = productRows.slice(i, i + BATCH_SIZE);

    const { data, error } = await ctx.supabase
      .from('products')
      .upsert(batch, { onConflict: 'sku' })
      .select('product_id');

    if (error !== null) {
      ctx.log(`  ❌ Products batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      errors += batch.length;
    } else {
      inserted += data?.length ?? 0;
    }
  }

  const durationMs = Date.now() - start;
  ctx.log(`✅ Products synced: ${inserted} rows, ${errors} errors, ${durationMs}ms`);
  return { resource: 'products', inserted, updated: 0, errors, durationMs };
}

// ------------------------------------------------------------
// 5. Link sale_items → products by SKU
// ------------------------------------------------------------

/**
 * After products are populated, update sale_items.product_id
 * by matching on SKU. This is a single UPDATE ... FROM ... WHERE
 * that links all orphaned sale_items to their products.
 */
export async function linkSaleItemProducts(ctx: SyncContext): Promise<SyncResult> {
  const start = Date.now();

  ctx.log('🔗 Linking sale_items → products by SKU...');

  // Use raw SQL via RPC because Supabase JS doesn't support UPDATE FROM
  const { error } = await ctx.supabase.rpc('link_sale_items_to_products' as never);

  if (error !== null) {
    // RPC doesn't exist yet — fall back to manual approach
    ctx.log(`  RPC not available, using manual batch approach...`);

    // Fetch all products with SKU
    const { data: products, error: pErr } = await ctx.supabase
      .from('products')
      .select('product_id, sku')
      .not('sku', 'is', null);

    if (pErr !== null || products === null) {
      ctx.log(`  ❌ Failed to load products: ${pErr?.message}`);
      return { resource: 'link_items', inserted: 0, updated: 0, errors: 1, durationMs: Date.now() - start };
    }

    const skuMap = new Map<string, number>();
    for (const p of products) {
      if (p.sku !== null) {
        skuMap.set(p.sku as string, p.product_id as number);
      }
    }

    ctx.log(`  Products with SKU loaded: ${skuMap.size}`);

    // Fetch sale_items where product_id is null AND sku is not null
    let updated = 0;
    let page = 0;
    const FETCH_SIZE = 1000;

    while (true) {
      const { data: items, error: iErr } = await ctx.supabase
        .from('sale_items')
        .select('sale_item_id, sku')
        .is('product_id', null)
        .not('sku', 'is', null)
        .range(page * FETCH_SIZE, (page + 1) * FETCH_SIZE - 1);

      if (iErr !== null || items === null || items.length === 0) break;

      // Group by product_id to batch updates
      const updatesByProductId = new Map<number, number[]>();
      for (const item of items) {
        if (item.sku === null) continue;
        const productId = skuMap.get(item.sku as string);
        if (productId === undefined) continue;
        const arr = updatesByProductId.get(productId) ?? [];
        arr.push(item.sale_item_id as number);
        updatesByProductId.set(productId, arr);
      }

      for (const [productId, itemIds] of updatesByProductId) {
        const { error: uErr } = await ctx.supabase
          .from('sale_items')
          .update({ product_id: productId })
          .in('sale_item_id', itemIds);

        if (uErr !== null) {
          ctx.log(`  ❌ Update batch for product ${productId}: ${uErr.message}`);
        } else {
          updated += itemIds.length;
        }
      }

      if (items.length < FETCH_SIZE) break;
      page++;
    }

    const durationMs = Date.now() - start;
    ctx.log(`✅ Linked ${updated} sale_items to products, ${durationMs}ms`);
    return { resource: 'link_items', inserted: 0, updated, errors: 0, durationMs };
  }

  const durationMs = Date.now() - start;
  ctx.log(`✅ Link complete, ${durationMs}ms`);
  return { resource: 'link_items', inserted: 0, updated: 0, errors: 0, durationMs };
}
