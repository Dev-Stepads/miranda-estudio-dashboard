/**
 * Canonical shapes — the normalized, source-agnostic representation
 * of each entity after being mapped from a raw integration response.
 *
 * These types MUST match the Supabase schema defined in
 * `supabase/migrations/20260411120000_initial_schema.sql`. Any drift
 * means the ETL will fail at insert time. Update both in lockstep.
 *
 * Decisions that shaped these types:
 * - Money is `number`, not `string`. Raw APIs (Nuvemshop) return strings,
 *   we parseFloat at the mapper boundary so downstream code never worries.
 * - Dates are ISO 8601 strings, not Date objects. The database column
 *   is `timestamptz` which accepts ISO strings directly; constructing
 *   JS Date objects at every layer adds bugs and TZ surprises.
 * - Enums are string unions, not TypeScript `enum`. Same reasoning as
 *   the schema's CHECK constraints vs native PG ENUM — easier to extend.
 */

export type IntegrationSource = 'conta_azul' | 'nuvemshop' | 'meta_ads';

export type SaleStatus =
  | 'paid'
  | 'cancelled'
  | 'refunded'
  | 'pending';

export type Gender = 'male' | 'female' | 'other' | 'unknown';

export type AgeRange =
  | '18-24'
  | '25-34'
  | '35-44'
  | '45-54'
  | '55+'
  | 'unknown';

/**
 * A single line item inside a sale. Mapped 1:1 to `sale_items` rows.
 */
export interface CanonicalSaleItem {
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
}

/**
 * One sale event (invoice, order, ticket). Mapped 1:1 to a `sales` row
 * plus N `sale_items` rows. The ETL is responsible for the transaction.
 */
export interface CanonicalSale {
  source: IntegrationSource;
  source_id: string;
  /**
   * Canonical sale date in ISO 8601 (timestamptz in DB).
   * - Nuvemshop: `paid_at` if available, else `created_at`.
   * - Conta Azul: `data_emissao` of the NF-e.
   * See DECISOES.txt 2026-04-10 "Data canônica da venda por fonte".
   */
  sale_date: string;
  total_gross: number;
  total_net: number;
  status: SaleStatus;
  /**
   * Customer from the same source. The ETL joins this to a canonical
   * `customers` row via (source, source_id).
   */
  customer_source_id: string | null;
  payment_method: string | null;
  items: CanonicalSaleItem[];
}

/**
 * A person who transacts with the business (end-customer only —
 * Conta Azul "Fornecedor"/"Funcionário" are filtered out upstream).
 * Mapped 1:1 to a `customers` row.
 */
export interface CanonicalCustomer {
  source: IntegrationSource;
  source_id: string;
  name: string;
  gender: Gender;
  /**
   * Age is nullable because both Conta Azul (never) and Nuvemshop
   * (depends on custom field) may omit it. The age_range is a derived
   * bucket; both fields are present for querying flexibility.
   */
  age: number | null;
  age_range: AgeRange;
  state: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  /**
   * CPF (11 digits) or CNPJ (14 digits) — PII. Never expose via
   * the public dashboard API.
   */
  document: string | null;
}

/**
 * An item in the store's catalog. Canonical deduplication happens
 * at the ETL layer by matching `sku` across sources (REGRAS §3).
 */
export interface CanonicalProduct {
  source: IntegrationSource;
  source_id: string;
  name: string;
  sku: string | null;
  price: number;
}

/**
 * Shopping cart abandoned before payment. Nuvemshop only (Conta Azul
 * has no equivalent). Mapped 1:1 to `abandoned_checkouts`.
 */
export interface CanonicalAbandonedCheckout {
  source: IntegrationSource;
  source_id: string;
  customer_source_id: string | null;
  total_value: number;
  abandoned_at: string;
  items_count: number;
}
