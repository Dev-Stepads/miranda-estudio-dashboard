/**
 * Zod schemas for raw Conta Azul API responses.
 *
 * Rules of the road:
 * - ALL object schemas use `.passthrough()` because the API often adds
 *   fields between versions and we don't want validation to fail on
 *   harmless extras.
 * - Conta Azul has THREE DIFFERENT pagination wrapper styles across
 *   endpoints (discovered via live exploration 2026-04-11):
 *     * /v1/categorias    → { itens_totais, itens }   (PT-BR)
 *     * /v1/produtos      → { totalItems,  items }    (EN)
 *     * /v1/pessoas       → { totalItems,  items }    (EN)
 *     * /v1/notas-fiscais → { itens }                  (bare, no total)
 *   We model each via a generic `wrapper<Item>()` helper so the client
 *   consumes them with the same interface.
 * - Schema field names are in Portuguese (API language). Do NOT rename
 *   them to English — the raw types are the DTO contract.
 *
 * See MAPEAMENTO_CONTA_AZUL.txt Appendix 2026-04-11 §A6 for the schemas
 * as observed in real responses.
 */

import { z } from 'zod';

// ------------------------------------------------------------
// Pagination wrapper helpers
// ------------------------------------------------------------

/**
 * PT-BR wrapper: `{ itens_totais: number, itens: T[] }`.
 * Used by `/v1/categorias`.
 */
export function ptWrapperSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    itens_totais: z.number(),
    itens: z.array(itemSchema),
  });
}

/**
 * EN wrapper: `{ totalItems: number, items: T[] }`.
 * Used by `/v1/produtos` and `/v1/pessoas`.
 */
export function enWrapperSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    totalItems: z.number(),
    items: z.array(itemSchema),
  });
}

/**
 * Bare wrapper: `{ itens: T[] }` (no total).
 * Used by `/v1/notas-fiscais`. Caller must paginate by trial-and-error
 * or by detecting empty responses.
 */
export function bareWrapperSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    itens: z.array(itemSchema),
  });
}

// ------------------------------------------------------------
// Categoria (financial category — hierarchical tree)
// ------------------------------------------------------------

export const RawContaAzulCategoriaSchema = z
  .object({
    id: z.string(),
    versao: z.number(),
    nome: z.string(),
    categoria_pai: z.string().nullable(),
    tipo: z.enum(['DESPESA', 'RECEITA']).or(z.string()),
    entrada_dre: z.string().nullable(),
    considera_custo_dre: z.boolean(),
  })
  .passthrough();

export const CategoriasListSchema = ptWrapperSchema(RawContaAzulCategoriaSchema);

// ------------------------------------------------------------
// Pessoa (person — clients, suppliers, carriers, employees all mixed)
// ------------------------------------------------------------

/**
 * ⚠ IMPORTANT: /v1/pessoas returns ALL person records, not just clients.
 * Filter by `perfis` including 'Cliente' BEFORE mapping to canonical.
 * See mapper.ts `isContaAzulCustomer()`.
 */
export const RawContaAzulPessoaSchema = z
  .object({
    id: z.string(),
    nome: z.string(),
    /** CPF (11 digits) or CNPJ (14 digits) — PII. */
    documento: z.string().default(''),
    email: z.string().default(''),
    telefone: z.string().default(''),
    ativo: z.boolean(),
    id_legado: z.number().default(0),
    uuid_legado: z.string().default(''),
    /** Role tags — must include 'Cliente' for customer mapping. */
    perfis: z.array(z.string()),
    tipo_pessoa: z.enum(['Jurídica', 'Física']).or(z.string()),
    /** ISO 8601 without explicit TZ — assume UTC per MAPEAMENTO §A6. */
    data_criacao: z.string().optional(),
    data_alteracao: z.string().optional(),
  })
  .passthrough();

export const PessoasListSchema = enWrapperSchema(RawContaAzulPessoaSchema);

// ------------------------------------------------------------
// Produto + Variação (products have nested variations)
// ------------------------------------------------------------

/** Shared shape for product variations (children of a parent product). */
const RawContaAzulProdutoVariacaoSchema = z
  .object({
    id: z.string(),
    id_legado: z.number().default(0),
    nome: z.string(),
    codigo: z.string().default(''),
    ean: z.string().default(''),
    tipo: z.string(),
    status: z.string(),
    saldo: z.number(),
    valor_venda: z.number(),
    custo_medio: z.number(),
    /** camelCase typo of the API (diferente do pai) — manter fiel. */
    aggregationCount: z.number().optional(),
    nivel_estoque: z.string().optional(),
    estoque_minimo: z.number().optional(),
    estoque_maximo: z.number().optional(),
    movido: z.boolean().optional(),
    id_produto_pai_variacao: z.string(),
    integracao_ecommerce_ativada: z.boolean().optional(),
  })
  .passthrough();

export const RawContaAzulProdutoSchema = z
  .object({
    id: z.string(),
    id_legado: z.number().default(0),
    nome: z.string(),
    /** Internal SKU — this is the canonical "sku" field. */
    codigo: z.string().default(''),
    tipo: z.string(),
    status: z.string(),
    saldo: z.number(),
    valor_venda: z.number(),
    custo_medio: z.number(),
    contagem_agregacao: z.number().optional(),
    nivel_estoque: z.string().optional(),
    estoque_minimo: z.number().optional(),
    estoque_maximo: z.number().optional(),
    movido: z.boolean().optional(),
    integracao_ecommerce_ativada: z.boolean().optional(),
    /** External barcode (EAN-13) — optional, may be empty string. */
    ean: z.string().default(''),
    ultima_atualizacao: z.string().optional(),
    produtos_variacao: z.array(RawContaAzulProdutoVariacaoSchema).optional(),
  })
  .passthrough();

export const ProdutosListSchema = enWrapperSchema(RawContaAzulProdutoSchema);

// ------------------------------------------------------------
// Nota Fiscal (list — minimal shape; detail endpoint TBD in T8)
// ------------------------------------------------------------

/**
 * Nota Fiscal in the list endpoint. Detail endpoint not yet discovered
 * during exploration. Fields known to be MISSING from this shape:
 *   - valor_total / valor_produtos
 *   - items (product lines)
 *   - forma_pagamento
 *   - vendedor_responsavel (canal filter for "LOJA FÍSICA")
 *   - id (UUID) — only chave_acesso and numero_nota available
 *
 * Mapper in mapper.ts returns a PARTIAL sale marked with __partial: true
 * so downstream code knows to fetch details before using money fields.
 */
export const RawContaAzulNotaFiscalSchema = z
  .object({
    /**
     * May be "0001-01-01T00:00:00Z" as a placeholder for "date not set".
     * Treat that value as null in the mapper.
     */
    data_emissao: z.string(),
    /** PII — customer name. */
    nome_destinatario: z.string(),
    numero_nota: z.number(),
    /** 44-char NF-e access key (contains issuer CNPJ). */
    chave_acesso: z.string(),
    status: z.string(),
  })
  .passthrough();

export const NotasFiscaisListSchema = bareWrapperSchema(RawContaAzulNotaFiscalSchema);

// ------------------------------------------------------------
// OAuth token response (/oauth2/token grant_type=refresh_token | authorization_code)
// ------------------------------------------------------------

/**
 * Response body from POST https://auth.contaazul.com/oauth2/token.
 * - `expires_in` is seconds (always 3600 in practice = 1 hour).
 * - `refresh_token` is SINGLE-USE and must replace the one used.
 * - `id_token` is a JWT (Cognito) with the user identity; optional for us.
 */
export const ContaAzulTokenResponseSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    id_token: z.string().optional(),
    token_type: z.string(),
    expires_in: z.number(),
  })
  .passthrough();
