/**
 * Integration tests for NuvemshopClient using msw to intercept HTTP.
 *
 * These tests validate the *contract* of the client (headers sent,
 * URL construction, error mapping, response parsing) — NOT the real
 * Nuvemshop API behavior. If the real API changes, unit tests pass
 * but real calls fail — that's caught at a higher integration layer.
 */

import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../setup.ts';
import {
  NuvemshopClient,
  extractLinkRel,
} from '../../../src/integrations/nuvemshop/client.ts';
import {
  HttpError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '../../../src/lib/errors.ts';

// ---------------------------------------------------------------
// Shared fixture values
// ---------------------------------------------------------------

const STORE_ID = 1124025;
const API_BASE = `https://api.nuvemshop.com.br/2025-03/${STORE_ID}`;

type NuvemshopClientConfigInput = ConstructorParameters<typeof NuvemshopClient>[0];

function makeClient(overrides: Partial<NuvemshopClientConfigInput> = {}) {
  return new NuvemshopClient({
    accessToken: 'test-access-token',
    storeId: STORE_ID,
    userAgent: 'Miranda Dashboard Test (test@example.com)',
    ...overrides,
  });
}

// ---------------------------------------------------------------
// extractLinkRel (public helper)
// ---------------------------------------------------------------

describe('extractLinkRel', () => {
  it('parses a single rel value', () => {
    const header = '<https://api.example.com/orders?page=2>; rel="next"';
    expect(extractLinkRel(header, 'next')).toBe('https://api.example.com/orders?page=2');
  });

  it('parses multiple rel values', () => {
    const header =
      '<https://api.example.com/orders?page=2>; rel="next", <https://api.example.com/orders?page=5>; rel="last"';
    expect(extractLinkRel(header, 'next')).toBe('https://api.example.com/orders?page=2');
    expect(extractLinkRel(header, 'last')).toBe('https://api.example.com/orders?page=5');
  });

  it('returns null when the rel is not present', () => {
    const header = '<https://api.example.com/orders?page=2>; rel="next"';
    expect(extractLinkRel(header, 'prev')).toBeNull();
  });

  it('returns null for null or empty header', () => {
    expect(extractLinkRel(null, 'next')).toBeNull();
    expect(extractLinkRel('', 'next')).toBeNull();
  });
});

// ---------------------------------------------------------------
// Auth headers (the CRITICAL pegadinha)
// ---------------------------------------------------------------

describe('NuvemshopClient auth headers', () => {
  it('sends "Authentication: bearer <token>" (lowercase bearer, non-standard header name)', async () => {
    let capturedHeaders: Headers | null = null;

    server.use(
      http.get(`${API_BASE}/orders`, ({ request }) => {
        capturedHeaders = request.headers;
        return HttpResponse.json([], {
          headers: {
            'x-total-count': '0',
            'x-rate-limit-limit': '40',
            'x-rate-limit-remaining': '39',
            'x-rate-limit-reset': '1000',
          },
        });
      }),
    );

    await makeClient().listOrders();

    expect(capturedHeaders).not.toBeNull();
    // The canonical header is "Authentication" (not "Authorization")
    expect(capturedHeaders!.get('Authentication')).toBe('bearer test-access-token');
    // And "Authorization" should NOT be set — otherwise we're leaking an unused header
    expect(capturedHeaders!.get('Authorization')).toBeNull();
  });

  it('sends the required User-Agent', async () => {
    let capturedHeaders: Headers | null = null;

    server.use(
      http.get(`${API_BASE}/orders`, ({ request }) => {
        capturedHeaders = request.headers;
        return HttpResponse.json([], { headers: { 'x-total-count': '0' } });
      }),
    );

    await makeClient({ userAgent: 'Miranda Dashboard (dev@stepads.com.br)' }).listOrders();

    expect(capturedHeaders!.get('User-Agent')).toBe('Miranda Dashboard (dev@stepads.com.br)');
  });
});

// ---------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------

describe('NuvemshopClient URL construction', () => {
  it('builds the correct list URL with default API version', async () => {
    let capturedUrl: URL | null = null;

    server.use(
      http.get(`${API_BASE}/orders`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json([]);
      }),
    );

    await makeClient().listOrders();
    expect(capturedUrl!.pathname).toBe(`/2025-03/${STORE_ID}/orders`);
  });

  it('respects a custom apiVersion', async () => {
    let capturedUrl: URL | null = null;

    server.use(
      http.get(`https://api.nuvemshop.com.br/2026-09/${STORE_ID}/orders`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json([]);
      }),
    );

    await makeClient({ apiVersion: '2026-09' }).listOrders();
    expect(capturedUrl!.pathname).toBe(`/2026-09/${STORE_ID}/orders`);
  });

  it('maps list options to query params', async () => {
    let capturedUrl: URL | null = null;

    server.use(
      http.get(`${API_BASE}/orders`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json([]);
      }),
    );

    await makeClient().listOrders({
      page: 2,
      perPage: 50,
      since: '2026-04-01',
      until: '2026-04-11',
      fields: ['id', 'total', 'paid_at'],
    });

    const params = capturedUrl!.searchParams;
    expect(params.get('page')).toBe('2');
    expect(params.get('per_page')).toBe('50');
    expect(params.get('created_at_min')).toBe('2026-04-01');
    expect(params.get('created_at_max')).toBe('2026-04-11');
    expect(params.get('fields')).toBe('id,total,paid_at');
  });
});

// ---------------------------------------------------------------
// Successful list parsing
// ---------------------------------------------------------------

describe('NuvemshopClient.listOrders success path', () => {
  it('parses items, pagination headers, and rate limit headers', async () => {
    server.use(
      http.get(`${API_BASE}/orders`, () => {
        return HttpResponse.json(
          [
            {
              id: 1,
              number: 1001,
              token: 't1',
              store_id: STORE_ID,
              contact_email: 'a@example.com',
              contact_name: 'A',
              contact_phone: '+55',
              contact_identification: '',
              subtotal: '100.00',
              total: '100.00',
              discount: '0.00',
              currency: 'BRL',
              gateway: '',
              gateway_name: '',
              status: 'closed',
              payment_status: 'paid',
              shipping_status: null,
              created_at: '2026-04-10T18:05:23-0300',
              updated_at: '2026-04-10T18:05:23-0300',
              paid_at: '2026-04-10T18:07:02-0300',
              cancelled_at: null,
              customer_id: 99,
            },
          ],
          {
            headers: {
              'x-total-count': '5925',
              link: `<${API_BASE}/orders?page=2>; rel="next", <${API_BASE}/orders?page=5925>; rel="last"`,
              'x-rate-limit-limit': '40',
              'x-rate-limit-remaining': '39',
              'x-rate-limit-reset': '1000',
            },
          },
        );
      }),
    );

    const result = await makeClient().listOrders();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(1);
    expect(result.pagination.total).toBe(5925);
    expect(result.pagination.nextUrl).toBe(`${API_BASE}/orders?page=2`);
    expect(result.pagination.lastUrl).toBe(`${API_BASE}/orders?page=5925`);
    expect(result.rateLimit).toEqual({ limit: 40, remaining: 39, resetMs: 1000 });
  });

  it('returns null pagination.nextUrl on the last page', async () => {
    server.use(
      http.get(`${API_BASE}/orders`, () => {
        return HttpResponse.json([], {
          headers: {
            'x-total-count': '5925',
            // Only `last` rel, no `next` — we're on the final page
            link: `<${API_BASE}/orders?page=5925>; rel="last"`,
          },
        });
      }),
    );

    const result = await makeClient().listOrders({ page: 5925 });
    expect(result.pagination.nextUrl).toBeNull();
    expect(result.pagination.lastUrl).toBe(`${API_BASE}/orders?page=5925`);
  });
});

// ---------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------

describe('NuvemshopClient error mapping', () => {
  it('maps 401 to UnauthorizedError', async () => {
    server.use(
      http.get(`${API_BASE}/orders`, () => {
        return HttpResponse.json({ code: 401, message: 'Unauthorized' }, { status: 401 });
      }),
    );

    await expect(makeClient().listOrders()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('maps 404 to NotFoundError', async () => {
    server.use(
      http.get(`${API_BASE}/orders/99999`, () => {
        return HttpResponse.json({ code: 404 }, { status: 404 });
      }),
    );

    await expect(makeClient().getOrder(99999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps 429 to RateLimitError with retryAfterMs derived from retry-after header', async () => {
    server.use(
      http.get(`${API_BASE}/orders`, () => {
        return HttpResponse.json({ code: 429 }, {
          status: 429,
          headers: { 'retry-after': '5' },
        });
      }),
    );

    try {
      await makeClient().listOrders();
      expect.fail('Expected RateLimitError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterMs).toBe(5000);
    }
  });

  it('maps 500 to HttpError', async () => {
    server.use(
      http.get(`${API_BASE}/orders`, () => {
        return HttpResponse.json({ error: 'oops' }, { status: 500 });
      }),
    );

    try {
      await makeClient().listOrders();
      expect.fail('Expected HttpError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(500);
    }
  });

  it('throws ValidationError when response shape is wrong', async () => {
    server.use(
      http.get(`${API_BASE}/orders/42`, () => {
        // Missing required fields like `id`, `total`, etc.
        return HttpResponse.json({ nope: true });
      }),
    );

    await expect(makeClient().getOrder(42)).rejects.toBeInstanceOf(ValidationError);
  });
});
