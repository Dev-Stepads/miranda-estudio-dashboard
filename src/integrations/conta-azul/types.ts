/**
 * Raw Conta Azul types — derived from Zod schemas via `z.infer`.
 * Never edit manually — change the schema in `./schemas.ts` instead.
 */

import type { z } from 'zod';
import type {
  RawContaAzulCategoriaSchema,
  RawContaAzulPessoaSchema,
  RawContaAzulProdutoSchema,
  RawContaAzulNotaFiscalSchema,
  RawContaAzulVendaListItemSchema,
  RawContaAzulVendaDetalheSchema,
  RawContaAzulVendaItemSchema,
  ContaAzulTokenResponseSchema,
} from './schemas.ts';

export type RawContaAzulCategoria = z.infer<typeof RawContaAzulCategoriaSchema>;
export type RawContaAzulPessoa = z.infer<typeof RawContaAzulPessoaSchema>;
export type RawContaAzulProduto = z.infer<typeof RawContaAzulProdutoSchema>;
export type RawContaAzulNotaFiscal = z.infer<typeof RawContaAzulNotaFiscalSchema>;
export type RawContaAzulVendaListItem = z.infer<typeof RawContaAzulVendaListItemSchema>;
export type RawContaAzulVendaDetalhe = z.infer<typeof RawContaAzulVendaDetalheSchema>;
export type RawContaAzulVendaItem = z.infer<typeof RawContaAzulVendaItemSchema>;
export type ContaAzulTokenResponse = z.infer<typeof ContaAzulTokenResponseSchema>;
