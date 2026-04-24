/**
 * Unit tests for Nuvemshop raw → canonical mappers.
 *
 * These are pure-function tests — no HTTP mocking needed. They pin down
 * the mapping rules so refactors can't silently change the canonical
 * shape.
 */

import { describe, expect, it } from 'vitest';

import {
  mapOrderToCanonicalSale,
  mapPaymentStatus,
  mapCustomerToCanonical,
  mapGender,
  mapProductToCanonical,
  mapCheckoutToCanonicalAbandoned,
  safeParseMoney,
} from '../../../src/integrations/nuvemshop/mapper.ts';
import type {
  RawNuvemshopOrder,
  RawNuvemshopCustomer,
  RawNuvemshopProduct,
  RawNuvemshopCheckout,
} from '../../../src/integrations/nuvemshop/types.ts';

// ---------------------------------------------------------------
// Fixtures (minimal, inline — mirror real API shape)
// ---------------------------------------------------------------

function makeOrder(overrides: Partial<RawNuvemshopOrder> = {}): RawNuvemshopOrder {
  return {
    id: 1944668557,
    number: 3763,
    token: 'abc-fake-token',
    store_id: 1124025,
    contact_email: 'customer@example.com',
    contact_name: 'Fake Customer',
    contact_phone: '+5511999999999',
    contact_identification: '00000000000',
    subtotal: '250.00',
    total: '259.70',
    discount: '0.00',
    currency: 'BRL',
    gateway: 'mercadopago',
    gateway_name: 'Mercado Pago',
    status: 'closed',
    payment_status: 'paid',
    shipping_status: 'shipped',
    created_at: '2026-04-10T18:05:23-0300',
    updated_at: '2026-04-10T19:12:44-0300',
    paid_at: '2026-04-10T18:07:02-0300',
    cancelled_at: null,
    customer: { id: 32547459 },
    customer_id: 32547459,
    products: [
      {
        id: 101,
        product_id: 46580309,
        variant_id: 981,
        name: 'Camiseta Confia Na Bahia (Cappuccino)',
        sku: 'MIR0285CAP',
        quantity: 1,
        price: '250.00',
        compare_at_price: null,
        total: '250.00',
      },
    ],
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<RawNuvemshopCustomer> = {}): RawNuvemshopCustomer {
  return {
    id: 32547459,
    name: 'Test Customer',
    email: 'test@example.com',
    identification: '12345678900',
    phone: '+5511988887777',
    default_address: {
      address: 'Rua Fake',
      city: 'Salvador',
      province: 'BA',
      country: 'BR',
      zipcode: '40000-000',
    },
    extra: { gender: 'female' },
    ...overrides,
  };
}

function makeProduct(overrides: Partial<RawNuvemshopProduct> = {}): RawNuvemshopProduct {
  return {
    id: 46580309,
    name: { pt: 'Camiseta Confia Na Bahia', es: 'Camiseta Confía', en: 'Trust Tee' },
    description: { pt: 'Descrição' },
    handle: { pt: 'camiseta-confia-na-bahia' },
    published: true,
    brand: 'Miranda Estúdio',
    variants: [
      {
        id: 981,
        product_id: 46580309,
        price: '250.00',
        promotional_price: null,
        stock: 18,
        sku: 'MIR0285CAP',
      },
    ],
    ...overrides,
  };
}

function makeCheckout(overrides: Partial<RawNuvemshopCheckout> = {}): RawNuvemshopCheckout {
  return {
    id: 9001,
    contact_email: 'lost@example.com',
    subtotal: '200.00',
    total: '220.00',
    currency: 'BRL',
    created_at: '2026-04-10T10:00:00-0300',
    updated_at: '2026-04-10T10:15:00-0300',
    customer: { id: 32547459, name: 'Lost', email: 'lost@example.com' },
    products: [
      {
        id: 1,
        product_id: 46580309,
        variant_id: 981,
        name: 'Item',
        sku: 'SKU1',
        quantity: 2,
        price: '100.00',
        compare_at_price: null,
        total: '200.00',
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------
// safeParseMoney
// ---------------------------------------------------------------

describe('safeParseMoney', () => {
  it('parses a plain numeric string', () => {
    expect(safeParseMoney('259.70')).toBe(259.7);
    expect(safeParseMoney('0.00')).toBe(0);
    expect(safeParseMoney('1234567.89')).toBe(1234567.89);
  });

  it('returns 0 for null, undefined, or empty', () => {
    expect(safeParseMoney(null)).toBe(0);
    expect(safeParseMoney(undefined)).toBe(0);
    expect(safeParseMoney('')).toBe(0);
  });

  it('returns 0 for non-numeric strings (no NaN leak)', () => {
    expect(safeParseMoney('not a number')).toBe(0);
    expect(safeParseMoney('abc')).toBe(0);
  });
});

// ---------------------------------------------------------------
// mapPaymentStatus
// ---------------------------------------------------------------

describe('mapPaymentStatus', () => {
  it('maps "paid" to paid', () => {
    expect(mapPaymentStatus('paid')).toBe('paid');
  });

  it('maps "partially_paid" to paid per REGRAS §2.2', () => {
    expect(mapPaymentStatus('partially_paid')).toBe('paid');
  });

  it('maps "cancelled" and "voided" to cancelled', () => {
    expect(mapPaymentStatus('cancelled')).toBe('cancelled');
    expect(mapPaymentStatus('voided')).toBe('cancelled');
  });

  it('maps "refunded" to refunded', () => {
    expect(mapPaymentStatus('refunded')).toBe('refunded');
  });

  it('maps in-flight statuses to pending', () => {
    expect(mapPaymentStatus('pending')).toBe('pending');
    expect(mapPaymentStatus('authorized')).toBe('pending');
    expect(mapPaymentStatus('in_process')).toBe('pending');
  });

  it('defaults unknown values to pending (defensive)', () => {
    expect(mapPaymentStatus('something_new_from_nuvemshop')).toBe('pending');
    expect(mapPaymentStatus('')).toBe('pending');
  });
});

// ---------------------------------------------------------------
// mapGender
// ---------------------------------------------------------------

describe('mapGender', () => {
  it('recognizes Portuguese values', () => {
    expect(mapGender('masculino')).toBe('male');
    expect(mapGender('feminino')).toBe('female');
    expect(mapGender('outro')).toBe('other');
  });

  it('recognizes English values', () => {
    expect(mapGender('male')).toBe('male');
    expect(mapGender('female')).toBe('female');
    expect(mapGender('other')).toBe('other');
  });

  it('accepts single-letter abbreviations', () => {
    expect(mapGender('m')).toBe('male');
    expect(mapGender('f')).toBe('female');
    expect(mapGender('o')).toBe('other');
  });

  it('is case-insensitive', () => {
    expect(mapGender('MALE')).toBe('male');
    expect(mapGender('Female')).toBe('female');
  });

  it('returns unknown for empty or unrecognized values', () => {
    expect(mapGender(undefined)).toBe('unknown');
    expect(mapGender('')).toBe('unknown');
    expect(mapGender('prefer not to say')).toBe('unknown');
  });
});

// ---------------------------------------------------------------
// mapOrderToCanonicalSale
// ---------------------------------------------------------------

describe('mapOrderToCanonicalSale', () => {
  it('produces a canonical sale with correct source and identifiers', () => {
    const result = mapOrderToCanonicalSale(makeOrder());
    expect(result.source).toBe('nuvemshop');
    expect(result.source_id).toBe('1944668557');
    expect(result.customer_source_id).toBe('32547459');
  });

  it('resolves customer_source_id from customer object (v2025-03 API)', () => {
    const result = mapOrderToCanonicalSale(
      makeOrder({ customer: { id: 99999 }, customer_id: undefined }),
    );
    expect(result.customer_source_id).toBe('99999');
  });

  it('falls back to customer_id when customer object is missing (legacy)', () => {
    const result = mapOrderToCanonicalSale(
      makeOrder({ customer: undefined, customer_id: 88888 }),
    );
    expect(result.customer_source_id).toBe('88888');
  });

  it('returns null customer_source_id when both customer and customer_id are null', () => {
    const result = mapOrderToCanonicalSale(
      makeOrder({ customer: null, customer_id: null }),
    );
    expect(result.customer_source_id).toBeNull();
  });

  it('prefers customer.id over customer_id when both present', () => {
    const result = mapOrderToCanonicalSale(
      makeOrder({ customer: { id: 111 }, customer_id: 222 }),
    );
    expect(result.customer_source_id).toBe('111');
  });

  it('uses paid_at as sale_date when present', () => {
    const result = mapOrderToCanonicalSale(makeOrder());
    expect(result.sale_date).toBe('2026-04-10T18:07:02-0300');
  });

  it('falls back to created_at when paid_at is null', () => {
    const result = mapOrderToCanonicalSale(makeOrder({ paid_at: null }));
    expect(result.sale_date).toBe('2026-04-10T18:05:23-0300');
  });

  it('parses money fields as numbers (not strings)', () => {
    const result = mapOrderToCanonicalSale(makeOrder());
    expect(typeof result.total_gross).toBe('number');
    // subtotal (sum of items) = gross, total (after discounts+shipping) = net
    expect(result.total_gross).toBe(250);
    expect(result.total_net).toBe(259.7);
  });

  it('prefers gateway_name over gateway for payment_method', () => {
    const result = mapOrderToCanonicalSale(makeOrder());
    expect(result.payment_method).toBe('Mercado Pago');
  });

  it('falls back to gateway when gateway_name is empty', () => {
    const result = mapOrderToCanonicalSale(
      makeOrder({ gateway_name: '', gateway: 'pagseguro' }),
    );
    expect(result.payment_method).toBe('pagseguro');
  });

  it('returns null payment_method when both are empty', () => {
    const result = mapOrderToCanonicalSale(makeOrder({ gateway_name: '', gateway: '' }));
    expect(result.payment_method).toBeNull();
  });

  it('maps line items with parsed money', () => {
    const result = mapOrderToCanonicalSale(makeOrder());
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.product_name).toBe('Camiseta Confia Na Bahia (Cappuccino)');
    expect(item.sku).toBe('MIR0285CAP');
    expect(item.quantity).toBe(1);
    expect(item.unit_price).toBe(250);
    expect(item.total_price).toBe(250);
  });

  it('returns an empty items array when products are missing (summary endpoint)', () => {
    const result = mapOrderToCanonicalSale(makeOrder({ products: undefined }));
    expect(result.items).toEqual([]);
  });

  it('maps partially_paid orders as paid', () => {
    const result = mapOrderToCanonicalSale(makeOrder({ payment_status: 'partially_paid' }));
    expect(result.status).toBe('paid');
  });
});

// ---------------------------------------------------------------
// mapCustomerToCanonical
// ---------------------------------------------------------------

describe('mapCustomerToCanonical', () => {
  it('produces a canonical customer with PII fields', () => {
    const result = mapCustomerToCanonical(makeCustomer());
    expect(result.source).toBe('nuvemshop');
    expect(result.source_id).toBe('32547459');
    expect(result.name).toBe('Test Customer');
    expect(result.email).toBe('test@example.com');
    expect(result.phone).toBe('+5511988887777');
    expect(result.document).toBe('12345678900');
  });

  it('extracts state and city from default_address', () => {
    const result = mapCustomerToCanonical(makeCustomer());
    expect(result.state).toBe('BA');
    expect(result.city).toBe('Salvador');
  });

  it('falls back to addresses[0] when default_address is missing', () => {
    const result = mapCustomerToCanonical(
      makeCustomer({
        default_address: null,
        addresses: [
          {
            address: 'Rua X',
            city: 'Rio',
            province: 'RJ',
            country: 'BR',
            zipcode: '20000-000',
          },
        ],
      }),
    );
    expect(result.state).toBe('RJ');
    expect(result.city).toBe('Rio');
  });

  it('returns null for geo fields when no address is present', () => {
    const result = mapCustomerToCanonical(
      makeCustomer({ default_address: null, addresses: [] }),
    );
    expect(result.state).toBeNull();
    expect(result.city).toBeNull();
  });

  it('maps gender from extra.gender', () => {
    expect(mapCustomerToCanonical(makeCustomer({ extra: { gender: 'male' } })).gender).toBe('male');
    expect(mapCustomerToCanonical(makeCustomer({ extra: undefined })).gender).toBe('unknown');
  });

  it('always returns null for age (GATE N#2 pending)', () => {
    const result = mapCustomerToCanonical(makeCustomer());
    expect(result.age).toBeNull();
    expect(result.age_range).toBe('unknown');
  });

  it('nulls out empty strings for optional PII fields', () => {
    const result = mapCustomerToCanonical(
      makeCustomer({ email: '', phone: null, identification: null }),
    );
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.document).toBeNull();
  });
});

// ---------------------------------------------------------------
// mapProductToCanonical
// ---------------------------------------------------------------

describe('mapProductToCanonical', () => {
  it('extracts Portuguese name by default', () => {
    const result = mapProductToCanonical(makeProduct());
    expect(result.name).toBe('Camiseta Confia Na Bahia');
  });

  it('falls back through languages if pt is missing', () => {
    const result = mapProductToCanonical(
      makeProduct({ name: { es: 'Camiseta Confía', en: 'Trust Tee' } }),
    );
    expect(result.name).toBe('Camiseta Confía');
  });

  it('uses first variant sku and price', () => {
    const result = mapProductToCanonical(makeProduct());
    expect(result.sku).toBe('MIR0285CAP');
    expect(result.price).toBe(250);
  });

  it('returns null sku and 0 price for products without variants', () => {
    const result = mapProductToCanonical(makeProduct({ variants: [] }));
    expect(result.sku).toBeNull();
    expect(result.price).toBe(0);
  });
});

// ---------------------------------------------------------------
// mapCheckoutToCanonicalAbandoned
// ---------------------------------------------------------------

describe('mapCheckoutToCanonicalAbandoned', () => {
  it('maps the basic shape correctly', () => {
    const result = mapCheckoutToCanonicalAbandoned(makeCheckout());
    expect(result.source).toBe('nuvemshop');
    expect(result.source_id).toBe('9001');
    expect(result.total_value).toBe(220);
    expect(result.abandoned_at).toBe('2026-04-10T10:15:00-0300');
    expect(result.customer_source_id).toBe('32547459');
    expect(result.items_count).toBe(1);
  });

  it('nulls out customer_source_id when customer is missing', () => {
    const result = mapCheckoutToCanonicalAbandoned(makeCheckout({ customer: null }));
    expect(result.customer_source_id).toBeNull();
  });

  it('returns 0 items_count when products are missing', () => {
    const result = mapCheckoutToCanonicalAbandoned(makeCheckout({ products: undefined }));
    expect(result.items_count).toBe(0);
  });
});
