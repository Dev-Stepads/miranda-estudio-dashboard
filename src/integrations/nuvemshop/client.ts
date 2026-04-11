/**
 * Nuvemshop HTTP client.
 *
 * ⚠ CRITICAL PEGADINHA: Nuvemshop uses the header `Authentication: bearer`
 *   (lowercase "bearer", non-standard spelling "Authentication" NOT
 *   "Authorization"). Copying generic OAuth2 examples WILL break auth.
 *   Validated in live exploration 2026-04-11.
 *
 * ⚠ User-Agent is MANDATORY. Missing it → 400 Bad Request immediately.
 *   Format: "App Name (contact@email)".
 *
 * Design notes:
 * - Configuration is injected (no process.env reads). Makes testing and
 *   multi-store support easier.
 * - Each list method returns items + pagination + rate limit in a single
 *   object so the caller can drive follow-up calls without re-parsing
 *   response headers.
 * - Zod parse happens AFTER fetch — `ValidationError` signals the API
 *   changed shape on us.
 */

import { z } from 'zod';

import { fetchJson, type FetchResponse } from '../../lib/http.ts';
import { ValidationError } from '../../lib/errors.ts';
import {
  NuvemshopOrderListSchema,
  NuvemshopCustomerListSchema,
  NuvemshopProductListSchema,
  NuvemshopCheckoutListSchema,
  RawNuvemshopOrderSchema,
  RawNuvemshopCustomerSchema,
  RawNuvemshopProductSchema,
} from './schemas.ts';
import type {
  RawNuvemshopOrder,
  RawNuvemshopCustomer,
  RawNuvemshopProduct,
  RawNuvemshopCheckout,
} from './types.ts';

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

const SOURCE = 'nuvemshop' as const;
const DEFAULT_API_VERSION = '2025-03';

export interface NuvemshopClientConfig {
  /** Access token returned by /apps/authorize/token. Does NOT expire. */
  accessToken: string;
  /** Store ID — the `user_id` field in the token exchange response. */
  storeId: number;
  /** Required by the API. Format: "App Name (contact@email)". */
  userAgent: string;
  /** API date version. Defaults to 2025-03. */
  apiVersion?: string;
}

// ------------------------------------------------------------
// Method-level types
// ------------------------------------------------------------

export interface NuvemshopListOptions {
  /** 1-indexed page. */
  page?: number;
  /** Items per page. Default 30, max 200 per Nuvemshop docs. */
  perPage?: number;
  /** ISO date (with or without time). Filters by `created_at >= since`. */
  since?: string;
  /** ISO date. Filters by `created_at <= until`. */
  until?: string;
  /**
   * Sparse fieldset — pass a list of fields to reduce payload size.
   * Nuvemshop joins with commas.
   */
  fields?: string[];
}

export interface RateLimitInfo {
  /** Total capacity of the leaky bucket (40 for basic, 400 for Next/Evolution). */
  limit: number;
  /** Capacity remaining after this request. */
  remaining: number;
  /** Time until one slot is freed (ms). */
  resetMs: number;
}

export interface PaginationInfo {
  /** Total items across all pages (from `x-total-count` header). */
  total: number | null;
  /** Next page URL from the `link` header, or null if last page. */
  nextUrl: string | null;
  /** Last page URL from the `link` header. */
  lastUrl: string | null;
}

export interface NuvemshopListResult<T> {
  items: T[];
  pagination: PaginationInfo;
  rateLimit: RateLimitInfo;
}

// ------------------------------------------------------------
// The client
// ------------------------------------------------------------

export class NuvemshopClient {
  private readonly baseUrl: string;
  private readonly authHeaders: Record<string, string>;

  constructor(config: NuvemshopClientConfig) {
    const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.baseUrl = `https://api.nuvemshop.com.br/${apiVersion}/${config.storeId}`;
    this.authHeaders = {
      // ⚠ DO NOT "correct" to "Authorization: Bearer". This is Nuvemshop's
      //   actual header. See MAPEAMENTO_NUVEMSHOP.txt §A6.
      Authentication: `bearer ${config.accessToken}`,
      'User-Agent': config.userAgent,
    };
  }

  // ------- Orders --------------------------------------------------

  async getOrder(id: number): Promise<RawNuvemshopOrder> {
    const response = await fetchJson<unknown>(
      `${this.baseUrl}/orders/${id}`,
      { headers: this.authHeaders },
      SOURCE,
    );
    return this.parseWithSchema(RawNuvemshopOrderSchema, response.body);
  }

  async listOrders(
    options: NuvemshopListOptions = {},
  ): Promise<NuvemshopListResult<RawNuvemshopOrder>> {
    const url = this.buildListUrl(`${this.baseUrl}/orders`, options);
    const response = await fetchJson<unknown>(url, { headers: this.authHeaders }, SOURCE);
    const items = this.parseWithSchema(NuvemshopOrderListSchema, response.body);
    return this.wrapList(items, response);
  }

  // ------- Customers -----------------------------------------------

  async getCustomer(id: number): Promise<RawNuvemshopCustomer> {
    const response = await fetchJson<unknown>(
      `${this.baseUrl}/customers/${id}`,
      { headers: this.authHeaders },
      SOURCE,
    );
    return this.parseWithSchema(RawNuvemshopCustomerSchema, response.body);
  }

  async listCustomers(
    options: NuvemshopListOptions = {},
  ): Promise<NuvemshopListResult<RawNuvemshopCustomer>> {
    const url = this.buildListUrl(`${this.baseUrl}/customers`, options);
    const response = await fetchJson<unknown>(url, { headers: this.authHeaders }, SOURCE);
    const items = this.parseWithSchema(NuvemshopCustomerListSchema, response.body);
    return this.wrapList(items, response);
  }

  // ------- Products ------------------------------------------------

  async getProduct(id: number): Promise<RawNuvemshopProduct> {
    const response = await fetchJson<unknown>(
      `${this.baseUrl}/products/${id}`,
      { headers: this.authHeaders },
      SOURCE,
    );
    return this.parseWithSchema(RawNuvemshopProductSchema, response.body);
  }

  async listProducts(
    options: NuvemshopListOptions = {},
  ): Promise<NuvemshopListResult<RawNuvemshopProduct>> {
    const url = this.buildListUrl(`${this.baseUrl}/products`, options);
    const response = await fetchJson<unknown>(url, { headers: this.authHeaders }, SOURCE);
    const items = this.parseWithSchema(NuvemshopProductListSchema, response.body);
    return this.wrapList(items, response);
  }

  // ------- Abandoned Checkouts -------------------------------------

  async listAbandonedCheckouts(
    options: NuvemshopListOptions = {},
  ): Promise<NuvemshopListResult<RawNuvemshopCheckout>> {
    const url = this.buildListUrl(`${this.baseUrl}/checkouts`, options);
    const response = await fetchJson<unknown>(url, { headers: this.authHeaders }, SOURCE);
    const items = this.parseWithSchema(NuvemshopCheckoutListSchema, response.body);
    return this.wrapList(items, response);
  }

  // ------- Internals -----------------------------------------------

  private buildListUrl(base: string, options: NuvemshopListOptions): string {
    const url = new URL(base);
    if (options.page !== undefined) url.searchParams.set('page', String(options.page));
    if (options.perPage !== undefined) url.searchParams.set('per_page', String(options.perPage));
    if (options.since !== undefined) url.searchParams.set('created_at_min', options.since);
    if (options.until !== undefined) url.searchParams.set('created_at_max', options.until);
    if (options.fields && options.fields.length > 0) {
      url.searchParams.set('fields', options.fields.join(','));
    }
    return url.toString();
  }

  /**
   * Parse `data` with `schema` and return the output (post-default) type.
   * Uses `z.output<S>` so that defaults and transforms are reflected in
   * the returned type — the raw `z.ZodType<T>` constraint loses this.
   */
  private parseWithSchema<S extends z.ZodTypeAny>(
    schema: S,
    data: unknown,
  ): z.output<S> {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new ValidationError(SOURCE, result.error);
    }
    return result.data;
  }

  private wrapList<T>(items: T[], response: FetchResponse<unknown>): NuvemshopListResult<T> {
    return {
      items,
      pagination: this.extractPagination(response),
      rateLimit: this.extractRateLimit(response),
    };
  }

  private extractPagination(response: FetchResponse<unknown>): PaginationInfo {
    const totalHeader = response.headers.get('x-total-count');
    const linkHeader = response.headers.get('link');
    const total = totalHeader !== null && totalHeader !== '' ? Number(totalHeader) : null;
    return {
      total: total !== null && Number.isFinite(total) ? total : null,
      nextUrl: extractLinkRel(linkHeader, 'next'),
      lastUrl: extractLinkRel(linkHeader, 'last'),
    };
  }

  private extractRateLimit(response: FetchResponse<unknown>): RateLimitInfo {
    return {
      limit: parseNumericHeader(response.headers.get('x-rate-limit-limit')),
      remaining: parseNumericHeader(response.headers.get('x-rate-limit-remaining')),
      resetMs: parseNumericHeader(response.headers.get('x-rate-limit-reset')),
    };
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Parse a Link header (RFC 5988) and return the URL for a given rel.
 * Example: `<https://.../orders?page=2>; rel="next", <...>; rel="last"`
 */
export function extractLinkRel(
  header: string | null,
  rel: 'next' | 'prev' | 'first' | 'last',
): string | null {
  if (header === null || header.length === 0) return null;
  const pattern = new RegExp(`<([^>]+)>\\s*;\\s*rel="${rel}"`);
  const match = header.match(pattern);
  return match !== null && match[1] !== undefined ? match[1] : null;
}

function parseNumericHeader(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
