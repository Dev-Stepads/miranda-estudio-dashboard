/**
 * Conta Azul HTTP client.
 *
 * Auth model: this client consumes an already-valid access_token. The
 * caller is responsible for obtaining and rotating it — use
 * `ContaAzulTokenManager` from `./auth.ts` for that, or call
 * `refreshAccessToken()` manually and pass the fresh token to a new
 * client instance.
 *
 * Design notes:
 * - The base URL was verified via live exploration: `api-v2.contaazul.com`,
 *   NOT `api.contaazul.com` as the old docs suggest. See MAPEAMENTO §A1.
 * - The API has THREE different pagination wrappers. Each list method
 *   parses its specific wrapper and normalizes to `{ total, items }`.
 * - `tamanho_pagina` must be one of [10, 20, 50, 100, 200, 500, 1000]
 *   or the API returns 400. We expose a typed enum to prevent typos.
 * - `/v1/notas-fiscais` requires `data_inicial` + `data_final`
 *   (YYYY-MM-DD) as mandatory query params. Calling without them
 *   returns a generic "Campos obrigatórios não informados" 400.
 */

import { z } from 'zod';

import { fetchJson } from '../../lib/http.ts';
import { ValidationError } from '../../lib/errors.ts';
import {
  CategoriasListSchema,
  PessoasListSchema,
  ProdutosListSchema,
  NotasFiscaisListSchema,
} from './schemas.ts';
import type {
  RawContaAzulCategoria,
  RawContaAzulPessoa,
  RawContaAzulProduto,
  RawContaAzulNotaFiscal,
} from './types.ts';

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const SOURCE = 'conta-azul' as const;
const DEFAULT_BASE_URL = 'https://api-v2.contaazul.com/v1';

/**
 * Valid page sizes. The API rejects any other value with 400
 * "O tamanho da página deve ser um dos seguintes valores: 10, 20, 50,
 * 100, 200, 500 ou 1000".
 */
export type ContaAzulPageSize = 10 | 20 | 50 | 100 | 200 | 500 | 1000;

// ------------------------------------------------------------
// Config + method options
// ------------------------------------------------------------

export interface ContaAzulClientConfig {
  /** Current valid access_token. If it expires during a batch, catch
   *  UnauthorizedError, refresh, create a new client. */
  accessToken: string;
  /** Required — will appear in server logs for debugging. */
  userAgent: string;
  /** Optional override — default `https://api-v2.contaazul.com/v1`. */
  baseUrl?: string;
}

export interface ContaAzulListOptions {
  tamanhoPagina?: ContaAzulPageSize;
  /**
   * Page index (1-based). Conta Azul's pagination param name was not
   * fully verified during live exploration — we assume `pagina`
   * matching `tamanho_pagina`. Confirm in T8.
   */
  pagina?: number;
}

export interface ContaAzulNotasFiscaisOptions extends ContaAzulListOptions {
  /** YYYY-MM-DD. Required by the API. */
  dataInicial: string;
  /** YYYY-MM-DD. Required by the API. */
  dataFinal: string;
}

/**
 * Normalized response shape across all 3 Conta Azul pagination wrappers.
 * `total` is null for endpoints that don't return a count (notas-fiscais).
 */
export interface ContaAzulListResult<T> {
  items: T[];
  total: number | null;
}

// ------------------------------------------------------------
// The client
// ------------------------------------------------------------

export class ContaAzulClient {
  private readonly baseUrl: string;
  private readonly authHeaders: Record<string, string>;

  constructor(config: ContaAzulClientConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.authHeaders = {
      Authorization: `Bearer ${config.accessToken}`,
      'User-Agent': config.userAgent,
    };
  }

  // ------- Categorias (financial categories, PT wrapper) ---------

  async listCategorias(): Promise<ContaAzulListResult<RawContaAzulCategoria>> {
    const response = await fetchJson<unknown>(
      `${this.baseUrl}/categorias`,
      { headers: this.authHeaders },
      SOURCE,
    );
    const parsed = this.parseWithSchema(CategoriasListSchema, response.body);
    return { items: parsed.itens, total: parsed.itens_totais };
  }

  // ------- Produtos (EN wrapper with totalItems/items) ------------

  async listProdutos(
    options: ContaAzulListOptions = {},
  ): Promise<ContaAzulListResult<RawContaAzulProduto>> {
    const url = this.buildListUrl(`${this.baseUrl}/produtos`, options);
    const response = await fetchJson<unknown>(url, { headers: this.authHeaders }, SOURCE);
    const parsed = this.parseWithSchema(ProdutosListSchema, response.body);
    return { items: parsed.items, total: parsed.totalItems };
  }

  // ------- Pessoas (clients + suppliers + others, EN wrapper) -----

  /**
   * Returns ALL persons — clients, suppliers, carriers, employees.
   * The caller MUST filter with `isContaAzulCustomer()` from `./mapper.ts`
   * before mapping to canonical customers. This method does NOT filter
   * so the raw shape remains honest.
   */
  async listPessoas(
    options: ContaAzulListOptions = {},
  ): Promise<ContaAzulListResult<RawContaAzulPessoa>> {
    const url = this.buildListUrl(`${this.baseUrl}/pessoas`, options);
    const response = await fetchJson<unknown>(url, { headers: this.authHeaders }, SOURCE);
    const parsed = this.parseWithSchema(PessoasListSchema, response.body);
    return { items: parsed.items, total: parsed.totalItems };
  }

  // ------- Notas Fiscais (bare wrapper, requires dates) ----------

  async listNotasFiscais(
    options: ContaAzulNotasFiscaisOptions,
  ): Promise<ContaAzulListResult<RawContaAzulNotaFiscal>> {
    const url = new URL(`${this.baseUrl}/notas-fiscais`);
    url.searchParams.set('data_inicial', options.dataInicial);
    url.searchParams.set('data_final', options.dataFinal);
    if (options.tamanhoPagina !== undefined) {
      url.searchParams.set('tamanho_pagina', String(options.tamanhoPagina));
    }
    if (options.pagina !== undefined) {
      url.searchParams.set('pagina', String(options.pagina));
    }

    const response = await fetchJson<unknown>(
      url.toString(),
      { headers: this.authHeaders },
      SOURCE,
    );
    const parsed = this.parseWithSchema(NotasFiscaisListSchema, response.body);
    return { items: parsed.itens, total: null };
  }

  // ------- Internals ---------------------------------------------

  private buildListUrl(base: string, options: ContaAzulListOptions): string {
    const url = new URL(base);
    if (options.tamanhoPagina !== undefined) {
      url.searchParams.set('tamanho_pagina', String(options.tamanhoPagina));
    }
    if (options.pagina !== undefined) {
      url.searchParams.set('pagina', String(options.pagina));
    }
    return url.toString();
  }

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
}
