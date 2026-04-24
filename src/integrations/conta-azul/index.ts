export { ContaAzulClient } from './client.ts';
export type {
  ContaAzulClientConfig,
  ContaAzulListOptions,
  ContaAzulNotasFiscaisOptions,
  ContaAzulListResult,
  ContaAzulPageSize,
} from './client.ts';

export {
  exchangeCodeForTokens,
  refreshAccessToken,
  basicAuthHeader,
  ContaAzulTokenManager,
} from './auth.ts';
export type {
  ContaAzulOAuthCredentials,
  ContaAzulTokenManagerConfig,
  PersistTokensCallback,
} from './auth.ts';

export type {
  RawContaAzulCategoria,
  RawContaAzulPessoa,
  RawContaAzulProduto,
  RawContaAzulNotaFiscal,
  ContaAzulTokenResponse,
} from './types.ts';

export {
  isContaAzulCustomer,
  mapPessoaToCanonicalCustomer,
  mapNotaFiscalStatus,
} from './mapper.ts';
