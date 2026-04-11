/**
 * Raw Nuvemshop types — shapes exactly as they arrive from the API.
 *
 * These are DERIVED from the Zod schemas in `./schemas.ts` via `z.infer`,
 * so they're always in sync. Never edit these interfaces manually —
 * change the schema instead.
 *
 * Fields I have not personally verified (fixture-only or doc-only) are
 * marked with `[VER]` in the schema comments. Live-exploration verified
 * fields are marked `[OK]`.
 *
 * See `docs/producao/MAPEAMENTO_NUVEMSHOP.txt` Appendix 2026-04-11 for
 * the full set of findings from real API exploration.
 */

import type { z } from 'zod';
import type {
  RawNuvemshopOrderSchema,
  RawNuvemshopOrderProductSchema,
  RawNuvemshopCustomerSchema,
  RawNuvemshopAddressSchema,
  RawNuvemshopProductSchema,
  RawNuvemshopVariantSchema,
  RawNuvemshopCheckoutSchema,
} from './schemas.ts';

export type RawNuvemshopOrder = z.infer<typeof RawNuvemshopOrderSchema>;
export type RawNuvemshopOrderProduct = z.infer<typeof RawNuvemshopOrderProductSchema>;
export type RawNuvemshopCustomer = z.infer<typeof RawNuvemshopCustomerSchema>;
export type RawNuvemshopAddress = z.infer<typeof RawNuvemshopAddressSchema>;
export type RawNuvemshopProduct = z.infer<typeof RawNuvemshopProductSchema>;
export type RawNuvemshopVariant = z.infer<typeof RawNuvemshopVariantSchema>;
export type RawNuvemshopCheckout = z.infer<typeof RawNuvemshopCheckoutSchema>;
