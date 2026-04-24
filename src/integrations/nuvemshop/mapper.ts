/**
 * Nuvemshop raw → canonical mappers.
 *
 * These are PURE functions — no I/O, no global state, no side effects.
 * They take a raw type (validated by Zod in the client) and return a
 * canonical type that matches the Supabase schema.
 *
 * Design notes:
 * - All money arrives as strings in Nuvemshop. We parseFloat here, once,
 *   so downstream code never has to. Invalid numbers → 0 (defensive).
 * - `sale_date` prefers `paid_at` per DECISOES.txt 2026-04-10. Falls back
 *   to `created_at`.
 * - `partially_paid` is mapped to `paid` per REGRAS_CONSOLIDACAO §2.2.
 * - Gender extraction is forgiving (accepts PT and EN variants).
 * - Product names extract the `pt` locale (Miranda is pt-only).
 */

import type {
  RawNuvemshopOrder,
  RawNuvemshopCustomer,
  RawNuvemshopProduct,
  RawNuvemshopCheckout,
} from './types.ts';
import type {
  CanonicalSale,
  CanonicalSaleItem,
  CanonicalCustomer,
  CanonicalProduct,
  CanonicalAbandonedCheckout,
  SaleStatus,
  Gender,
} from '../../canonical/types.ts';
import { extractLocalized } from '../../lib/i18n.ts';
import { normalizeState } from '../../lib/brazil.ts';

// ------------------------------------------------------------
// Sales
// ------------------------------------------------------------

/**
 * Map a raw Nuvemshop order to a canonical sale.
 *
 * If the order has no `products` array (summary endpoint), `items`
 * will be empty — the caller is responsible for calling `getOrder(id)`
 * to load the full detail when needed.
 */
export function mapOrderToCanonicalSale(raw: RawNuvemshopOrder): CanonicalSale {
  const items: CanonicalSaleItem[] = (raw.products ?? []).map((p) => {
    const unitPrice = safeParseMoney(p.price);
    const rawTotal = safeParseMoney(p.total);
    // Nuvemshop list endpoint often omits `total` from line items
    // (discovered in ETL run 2026-04-12). Fall back to price × quantity.
    const totalPrice = rawTotal > 0 ? rawTotal : unitPrice * (p.quantity ?? 1);
    return {
      product_name: p.name,
      sku: p.sku,
      quantity: p.quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      source_product_id: p.product_id ?? null,
    };
  });

  return {
    source: 'nuvemshop',
    source_id: String(raw.id),
    sale_date: raw.paid_at || raw.created_at,
    total_gross: safeParseMoney(raw.total),     // total = what the customer pays (revenue for Miranda)
    total_net: safeParseMoney(raw.subtotal),   // subtotal = sum of line items before shipping
    status: mapPaymentStatus(raw.payment_status),
    // Nuvemshop v2025-03 sends `customer: { id }` object, not `customer_id` number.
    // Support both for backwards compatibility with older API versions/fixtures.
    customer_source_id: resolveCustomerSourceId(raw),
    payment_method: firstNonEmpty(raw.gateway_name, raw.gateway),
    items,
  };
}

/**
 * Map Nuvemshop `payment_status` to canonical `SaleStatus`.
 *
 * DECISÕES:
 * - `partially_paid` → `paid` (REGRAS §2.2).
 * - `voided` and `cancelled` → `cancelled`.
 * - Anything unknown → `pending` (safer than throwing).
 */
export function mapPaymentStatus(paymentStatus: string): SaleStatus {
  switch (paymentStatus) {
    case 'paid':
    case 'partially_paid':
      return 'paid';
    case 'cancelled':
    case 'voided':
      return 'cancelled';
    case 'refunded':
      return 'refunded';
    case 'pending':
    case 'authorized':
    case 'in_process':
    case 'abandoned':
      return 'pending';
    default:
      return 'pending';
  }
}

// ------------------------------------------------------------
// Customers
// ------------------------------------------------------------

/**
 * Map a raw Nuvemshop customer to a canonical customer.
 *
 * GATE N#1 (gender) and GATE N#2 (birthday/age) are PENDING until
 * Miranda confirms checkout settings. For now, gender best-effort
 * via `extra.gender` and age always null.
 */
export function mapCustomerToCanonical(raw: RawNuvemshopCustomer): CanonicalCustomer {
  const addr = raw.default_address ?? raw.addresses?.[0] ?? null;

  return {
    source: 'nuvemshop',
    source_id: String(raw.id),
    name: raw.name,
    gender: mapGender(raw.extra?.gender),
    age: null, // TODO(T21): extract from custom_fields birthday when available
    age_range: 'unknown',
    // normalizeState converts "Bahia" → "BA", "São Paulo" → "SP", etc.
    // Returns null for international or unrecognized values.
    state: normalizeState(addr?.province),
    city: nullIfEmpty(addr?.city),
    email: nullIfEmpty(raw.email),
    phone: nullIfEmpty(raw.phone),
    document: nullIfEmpty(raw.identification),
  };
}

export function mapGender(raw: string | undefined): Gender {
  if (raw === undefined || raw === null || raw === '') return 'unknown';
  const lower = raw.toLowerCase();
  if (lower === 'male' || lower === 'masculino' || lower === 'm') return 'male';
  if (lower === 'female' || lower === 'feminino' || lower === 'f') return 'female';
  if (lower === 'other' || lower === 'outro' || lower === 'o') return 'other';
  return 'unknown';
}

// ------------------------------------------------------------
// Products
// ------------------------------------------------------------

/**
 * Map a raw Nuvemshop product to a canonical product.
 *
 * Uses the first variant's SKU and price as the "representative" values.
 * For multi-variant products, the ETL should handle all variants
 * separately when that's required — this mapper targets the single-SKU
 * dashboard view (REGRAS §3).
 */
export function mapProductToCanonical(raw: RawNuvemshopProduct): CanonicalProduct {
  const firstVariant = raw.variants?.[0];
  // Extract root category name (first category in the array)
  const firstCategory = raw.categories?.[0];
  const category = firstCategory ? (extractLocalized(firstCategory.name, 'pt') || null) : null;
  return {
    source: 'nuvemshop',
    source_id: String(raw.id),
    name: extractLocalized(raw.name, 'pt'),
    sku: firstVariant?.sku ?? null,
    price: firstVariant !== undefined ? safeParseMoney(firstVariant.price) : 0,
    category,
  };
}

// ------------------------------------------------------------
// Abandoned Checkouts
// ------------------------------------------------------------

export function mapCheckoutToCanonicalAbandoned(
  raw: RawNuvemshopCheckout,
): CanonicalAbandonedCheckout {
  const customerId = raw.customer?.id;

  // Extract products list
  const products = (raw.products ?? []).map((p) => ({
    name: extractLocalized(p.name) || String(p.product_id ?? '?'),
    quantity: p.quantity ?? 1,
    price: safeParseMoney(p.price),
    variant_id: p.variant_id ?? null,
  }));

  // Extract state from customer address if available
  const custState = raw.customer?.default_address?.province
    ? normalizeState(raw.customer.default_address.province)
    : null;

  return {
    source: 'nuvemshop',
    source_id: String(raw.id),
    customer_source_id:
      customerId !== undefined && customerId !== null ? String(customerId) : null,
    total_value: safeParseMoney(raw.total),
    abandoned_at: raw.updated_at,
    items_count: products.length,
    contact_name: (raw as Record<string, unknown>).contact_name as string ?? null,
    contact_email: raw.contact_email || null,
    contact_phone: (raw as Record<string, unknown>).contact_phone as string ?? null,
    contact_state: custState,
    products,
  };
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Parse a money string to a number. Returns 0 for invalid/empty input
 * instead of NaN, because propagating NaN through SUM aggregates poisons
 * the whole dataset.
 */
export function safeParseMoney(value: string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Extract customer source ID from a raw order. Nuvemshop v2025-03 uses
 * `customer: { id }` object, older versions used `customer_id` number.
 */
function resolveCustomerSourceId(raw: RawNuvemshopOrder): string | null {
  // v2025-03: customer object with id
  const customerObj = raw.customer;
  if (customerObj !== null && customerObj !== undefined && typeof customerObj === 'object' && 'id' in customerObj) {
    const id = (customerObj as { id: number }).id;
    if (id !== null && id !== undefined) return String(id);
  }
  // Legacy: customer_id as number
  const legacyId = raw.customer_id;
  if (legacyId !== null && legacyId !== undefined) return String(legacyId);
  return null;
}

function nullIfEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}
