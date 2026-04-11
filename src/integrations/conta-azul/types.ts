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
  ContaAzulTokenResponseSchema,
} from './schemas.ts';

export type RawContaAzulCategoria = z.infer<typeof RawContaAzulCategoriaSchema>;
export type RawContaAzulPessoa = z.infer<typeof RawContaAzulPessoaSchema>;
export type RawContaAzulProduto = z.infer<typeof RawContaAzulProdutoSchema>;
export type RawContaAzulNotaFiscal = z.infer<typeof RawContaAzulNotaFiscalSchema>;
export type ContaAzulTokenResponse = z.infer<typeof ContaAzulTokenResponseSchema>;
