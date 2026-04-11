export { NuvemshopClient, extractLinkRel } from './client.ts';
export type {
  NuvemshopClientConfig,
  NuvemshopListOptions,
  NuvemshopListResult,
  PaginationInfo,
  RateLimitInfo,
} from './client.ts';

export type {
  RawNuvemshopOrder,
  RawNuvemshopOrderProduct,
  RawNuvemshopCustomer,
  RawNuvemshopAddress,
  RawNuvemshopProduct,
  RawNuvemshopVariant,
  RawNuvemshopCheckout,
} from './types.ts';

export {
  mapOrderToCanonicalSale,
  mapPaymentStatus,
  mapCustomerToCanonical,
  mapGender,
  mapProductToCanonical,
  mapCheckoutToCanonicalAbandoned,
  safeParseMoney,
} from './mapper.ts';
