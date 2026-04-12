/**
 * Zod schemas for raw Nuvemshop API responses.
 *
 * Rules of the road:
 * - ALL object schemas use `.passthrough()` so unknown fields don't fail
 *   validation. The API may add fields at any time and our tests contain
 *   metadata fields like `_note` / `_reference`.
 * - Fields known to be optional are `.optional()`. Fields that the API
 *   sometimes returns as `null` vs missing are `.nullable().optional()`.
 * - Monetary values come as STRINGS in Nuvemshop ("259.70"). The mapper
 *   parseFloat's them. We don't coerce here to keep the raw shape honest.
 * - String fields that may be empty use `.default('')` so the raw type
 *   always has a value even if the API sends null.
 *
 * See MAPEAMENTO_NUVEMSHOP.txt §4 (endpoints) and §5 (canonical fields)
 * + the Appendix 2026-04-11 for the source of truth.
 */

import { z } from 'zod';

// ------------------------------------------------------------
// Primitives
// ------------------------------------------------------------

/**
 * Localized string field — Nuvemshop returns product names as
 * `{ pt: "...", es: "...", en: "..." }`. All keys are optional.
 */
/**
 * I18n fields can have null values for any language key (Nuvemshop
 * sends null when the merchant didn't fill SEO/description for a
 * product in that language). Discovered in ETL run 2026-04-12.
 */
export const NuvemshopI18nSchema = z
  .object({
    pt: z.string().nullable().optional(),
    es: z.string().nullable().optional(),
    en: z.string().nullable().optional(),
  })
  .passthrough();

// ------------------------------------------------------------
// Address (used inside Customer)
// ------------------------------------------------------------

/**
 * Address fields can be `null` in real data (discovered in first ETL run
 * 2026-04-12 — customers with incomplete addresses have null for address,
 * city, province, country, zipcode). Original schema had `.default('')`
 * which only covers `undefined`, NOT `null`. Fixed to `.nullable()`.
 */
export const RawNuvemshopAddressSchema = z
  .object({
    address: z.string().nullable().default(null),
    number: z.string().nullable().optional(),
    city: z.string().nullable().default(null),
    province: z.string().nullable().default(null),
    country: z.string().nullable().default(null),
    zipcode: z.string().nullable().default(null),
    floor: z.string().nullable().optional(),
    locality: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  })
  .passthrough();

// ------------------------------------------------------------
// Order Product (line item inside an order)
// ------------------------------------------------------------

export const RawNuvemshopOrderProductSchema = z
  .object({
    id: z.number(),
    product_id: z.number(),
    variant_id: z.number().nullable(),
    name: z.string().default(''),
    sku: z.string().nullable(),
    quantity: z.number().default(1),
    /**
     * Monetary value as string — parseFloat at mapper layer.
     * Can be null for free items (discovered in ETL run 2026-04-12).
     */
    price: z.string().nullable().default('0'),
    compare_at_price: z.string().nullable(),
    /**
     * Line total (price × quantity, minus discounts).
     * Sometimes missing from the API for free items or partial orders
     * (discovered in first ETL run 2026-04-12). Defaults to '0' so
     * safeParseMoney returns 0 instead of crashing.
     */
    total: z.string().optional().default('0'),
    properties: z.array(z.unknown()).optional(),
  })
  .passthrough();

// ------------------------------------------------------------
// Order (= Sale canonical)
// ------------------------------------------------------------

export const RawNuvemshopOrderSchema = z
  .object({
    id: z.number(),
    number: z.number(),
    token: z.string(),
    store_id: z.number(),

    // Contact — PII — ALL nullable (Nuvemshop sends null for unfilled fields)
    contact_email: z.string().nullable().default(''),
    contact_name: z.string().nullable().default(''),
    contact_phone: z.string().nullable().default(''),
    contact_identification: z.string().nullable().default(''),

    // Billing address — ALL nullable because Nuvemshop sends null
    // for any field the customer didn't fill (discovered in ETL 2026-04-12).
    billing_name: z.string().nullable().optional(),
    billing_phone: z.string().nullable().optional(),
    billing_address: z.string().nullable().optional(),
    billing_city: z.string().nullable().optional(),
    billing_province: z.string().nullable().optional(),
    billing_zipcode: z.string().nullable().optional(),
    billing_country: z.string().nullable().optional(),

    // Money — all strings in Nuvemshop, all nullable defensively
    subtotal: z.string().nullable().default('0'),
    total: z.string().nullable().default('0'),
    discount: z.string().nullable().default('0.00'),
    currency: z.string().nullable().default('BRL'),

    // Payment — nullable
    gateway: z.string().nullable().default(''),
    gateway_name: z.string().nullable().default(''),
    payment_details: z.record(z.unknown()).optional(),

    // State machine
    status: z.string(),
    payment_status: z.string(),
    shipping_status: z.string().nullable().optional(),

    // Timestamps (ISO with TZ offset like "-0300")
    created_at: z.string(),
    updated_at: z.string(),
    /**
     * Can be string, null, OR an object (date serialization quirk
     * discovered in first ETL run 2026-04-12). We don't use this
     * field in canonical mapping, so accept any type defensively.
     */
    completed_at: z.unknown().optional(),
    paid_at: z.string().nullable().optional(),
    cancelled_at: z.string().nullable().optional(),
    closed_at: z.string().nullable().optional(),

    /** Nuvemshop v2025-03 returns full customer OBJECT, not just customer_id */
    customer: z.object({ id: z.number() }).passthrough().nullable().optional(),
    /** Legacy field — some API versions return customer_id as a number */
    customer_id: z.number().nullable().optional(),

    /**
     * Line items. Sometimes omitted when the API returns a "summary"
     * endpoint; use a dedicated detail call when you need these.
     */
    products: z.array(RawNuvemshopOrderProductSchema).optional(),
  })
  .passthrough();

// ------------------------------------------------------------
// Customer
// ------------------------------------------------------------

export const RawNuvemshopCustomerExtraSchema = z
  .object({
    /**
     * Built-in Nuvemshop demographic field. May be absent if the
     * Miranda checkout doesn't ask for it (GATE N#1, pending).
     */
    gender: z.string().optional(),
  })
  .passthrough();

export const RawNuvemshopCustomerSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    email: z.string().default(''),
    /**
     * CPF/CNPJ — nullable because Nuvemshop doesn't force the shopper
     * to fill it, and the store can enable/disable the field.
     */
    identification: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),

    addresses: z.array(RawNuvemshopAddressSchema).optional(),
    default_address: RawNuvemshopAddressSchema.nullable().optional(),

    extra: RawNuvemshopCustomerExtraSchema.optional(),

    total_spent: z.string().optional(),
    total_spent_currency: z.string().optional(),
    last_order_id: z.number().nullable().optional(),

    /** Custom fields configured by the store — birthday may live here. */
    custom_fields: z.array(z.record(z.unknown())).optional(),

    active: z.boolean().optional(),
    first_interaction: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

// ------------------------------------------------------------
// Product + Variant
// ------------------------------------------------------------

export const RawNuvemshopVariantSchema = z
  .object({
    id: z.number(),
    product_id: z.number(),
    /** Monetary as string. Nullable for variants with price not set (2026-04-12). */
    price: z.string().nullable().default('0'),
    promotional_price: z.string().nullable(),
    stock_management: z.boolean().optional(),
    stock: z.number().nullable(),
    sku: z.string().nullable(),
    /** `values` is an array of localized strings (one per attribute). */
    values: z.array(NuvemshopI18nSchema).optional(),
    weight: z.string().optional(),
    width: z.string().optional(),
    height: z.string().optional(),
    depth: z.string().optional(),
  })
  .passthrough();

export const RawNuvemshopImageSchema = z
  .object({
    id: z.number(),
    src: z.string(),
    position: z.number().optional(),
    /** alt is an I18n object {pt,es,en}, not an array (schema corrected 2026-04-12). */
    alt: z.unknown().optional(),
  })
  .passthrough();

export const RawNuvemshopProductSchema = z
  .object({
    id: z.number(),
    name: NuvemshopI18nSchema,
    description: NuvemshopI18nSchema.optional(),
    handle: NuvemshopI18nSchema.optional(),
    published: z.boolean(),
    free_shipping: z.boolean().optional(),
    requires_shipping: z.boolean().optional(),
    canonical_url: z.string().optional(),
    video_url: z.string().nullable().optional(),
    seo_title: NuvemshopI18nSchema.optional(),
    seo_description: NuvemshopI18nSchema.optional(),
    brand: z.string().nullable().optional(),
    variants: z.array(RawNuvemshopVariantSchema).optional(),
    images: z.array(RawNuvemshopImageSchema).optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

// ------------------------------------------------------------
// Abandoned Checkout
// ------------------------------------------------------------

export const RawNuvemshopCheckoutSchema = z
  .object({
    id: z.number(),
    token: z.string().optional(),
    abandoned_checkout_url: z.string().optional(),
    contact_email: z.string().default(''),
    contact_name: z.string().optional(),
    contact_phone: z.string().optional(),
    subtotal: z.string().default('0.00'),
    total: z.string().default('0.00'),
    currency: z.string().default('BRL'),
    created_at: z.string(),
    updated_at: z.string(),
    completed_at: z.string().nullable().optional(),
    /** Embedded customer — same shape as the /customers endpoint. */
    customer: RawNuvemshopCustomerSchema.nullable().optional(),
    products: z.array(RawNuvemshopOrderProductSchema).optional(),
  })
  .passthrough();

// ------------------------------------------------------------
// List response helpers
// ------------------------------------------------------------

export const NuvemshopOrderListSchema = z.array(RawNuvemshopOrderSchema);
export const NuvemshopCustomerListSchema = z.array(RawNuvemshopCustomerSchema);
export const NuvemshopProductListSchema = z.array(RawNuvemshopProductSchema);
export const NuvemshopCheckoutListSchema = z.array(RawNuvemshopCheckoutSchema);
