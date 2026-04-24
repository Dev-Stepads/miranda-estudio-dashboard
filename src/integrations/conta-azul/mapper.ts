/**
 * Conta Azul raw → canonical mappers.
 *
 * Pure functions, no I/O, no global state.
 *
 * Key differences from the Nuvemshop mappers:
 * - Money arrives as `number` (not string) — just passes through.
 * - Customer filtering is NONTRIVIAL: /v1/pessoas returns clients,
 *   suppliers, carriers, and employees mixed. Use `isContaAzulCustomer`
 *   to filter before mapping, OR the caller will get canonical
 *   "customer" rows for non-customers.
 * - Notas Fiscais list is MINIMAL — the mapper returns a partial sale
 *   marked with `__partial: true`. Downstream ETL must either:
 *     (a) fetch the detail endpoint (to discover in T8) and merge, or
 *     (b) treat these as "known NF-e exists" records without revenue.
 * - Product SKUs live in `codigo`, barcodes live in `ean` — do NOT
 *   confuse them (SKU = internal inventory code; EAN = global barcode).
 */

import type {
  RawContaAzulCategoria,
  RawContaAzulPessoa,
} from './types.ts';
import type {
  CanonicalCustomer,
  SaleStatus,
} from '../../canonical/types.ts';

// ------------------------------------------------------------
// Pessoa → Customer (WITH FILTER)
// ------------------------------------------------------------

/**
 * Returns true if the pessoa represents a customer (not a supplier,
 * carrier, or employee). Filters by checking `perfis` array for
 * 'Cliente' membership.
 *
 * @example
 * const canonicalCustomers = pessoas.items
 *   .filter(isContaAzulCustomer)
 *   .map(mapPessoaToCanonicalCustomer);
 */
export function isContaAzulCustomer(pessoa: RawContaAzulPessoa): boolean {
  if (!Array.isArray(pessoa.perfis)) return false;
  return pessoa.perfis.includes('Cliente');
}

/**
 * Map a Conta Azul pessoa (already filtered as a customer) to the
 * canonical customer shape.
 *
 * ⚠ This function does NOT re-check `perfis` — it assumes the caller
 * filtered with `isContaAzulCustomer()` first. If you pass a
 * non-Cliente pessoa, you get a canonical customer row for a supplier,
 * which pollutes the `customers` table.
 *
 * Conta Azul does not provide gender or age (GAP confirmed in T4), so
 * those fields are always `unknown`/`null`. Decision documented in
 * DECISOES.txt 2026-04-10 "Loja Física sem demografia de gênero/idade".
 */
export function mapPessoaToCanonicalCustomer(raw: RawContaAzulPessoa): CanonicalCustomer {
  return {
    source: 'conta_azul',
    source_id: raw.id,
    name: raw.nome,
    gender: 'unknown',
    age: null,
    age_range: 'unknown',
    // Conta Azul does not return address fields in /v1/pessoas list mode.
    // State and city require the detail endpoint (T12). For now: null.
    state: null,
    city: null,
    email: nullIfEmpty(raw.email),
    phone: nullIfEmpty(raw.telefone),
    document: nullIfEmpty(raw.documento),
  };
}

// ------------------------------------------------------------
// Nota Fiscal status mapper (kept — used by mapNotaFiscalStatus tests and future NF-e ETL)
// ------------------------------------------------------------

/**
 * Map Conta Azul NF-e status to canonical SaleStatus.
 * Only `EMITIDA` is confirmed via live exploration. Other values
 * ("CANCELADA", "CORRIGIDA COM SUCESSO") are doc-suggested but not
 * yet verified — `pending` as defensive fallback.
 */
export function mapNotaFiscalStatus(status: string): SaleStatus {
  switch (status) {
    case 'EMITIDA':
    case 'CORRIGIDA COM SUCESSO':
      return 'paid';
    case 'CANCELADA':
      return 'cancelled';
    default:
      return 'pending';
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Re-export of CanonicalCustomer fields helper — null out empty
 * strings for optional PII fields so the DB gets NULL, not ''.
 */
function nullIfEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value;
}

/**
 * Unused imports for tree-shaking hint. Keeps `RawContaAzulCategoria`
 * reachable from consumers of this module even though it has no
 * dedicated mapper (categories aren't canonicalized — they're just
 * reference data for the financial DRE).
 */
export type { RawContaAzulCategoria };
