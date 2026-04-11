/**
 * Tests for ContaAzulClient — auth header, URL construction, 3 pagination
 * wrappers, and error handling.
 */

import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../setup.ts';
import { ContaAzulClient } from '../../../src/integrations/conta-azul/client.ts';
import {
  HttpError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../src/lib/errors.ts';

const API_BASE = 'https://api-v2.contaazul.com/v1';

type ContaAzulClientConfigInput = ConstructorParameters<typeof ContaAzulClient>[0];

function makeClient(overrides: Partial<ContaAzulClientConfigInput> = {}): ContaAzulClient {
  return new ContaAzulClient({
    accessToken: 'test-access-token',
    userAgent: 'Miranda Dashboard Test (test@example.com)',
    ...overrides,
  });
}

// ------------------------------------------------------------
// Auth headers
// ------------------------------------------------------------

describe('ContaAzulClient auth headers', () => {
  it('sends "Authorization: Bearer <token>" (standard OAuth2 style)', async () => {
    let capturedHeaders: Headers | null = null;

    server.use(
      http.get(`${API_BASE}/categorias`, ({ request }) => {
        capturedHeaders = request.headers;
        return HttpResponse.json({ itens_totais: 0, itens: [] });
      }),
    );

    await makeClient().listCategorias();

    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!.get('Authorization')).toBe('Bearer test-access-token');
  });

  it('sends User-Agent', async () => {
    let capturedHeaders: Headers | null = null;

    server.use(
      http.get(`${API_BASE}/categorias`, ({ request }) => {
        capturedHeaders = request.headers;
        return HttpResponse.json({ itens_totais: 0, itens: [] });
      }),
    );

    await makeClient({ userAgent: 'My App (foo@bar.com)' }).listCategorias();

    expect(capturedHeaders!.get('User-Agent')).toBe('My App (foo@bar.com)');
  });

  it('uses the overridden baseUrl when provided', async () => {
    let capturedUrl: URL | null = null;

    server.use(
      http.get('https://example.test/v1/categorias', ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({ itens_totais: 0, itens: [] });
      }),
    );

    await makeClient({ baseUrl: 'https://example.test/v1' }).listCategorias();
    expect(capturedUrl!.hostname).toBe('example.test');
  });
});

// ------------------------------------------------------------
// 3 Different Pagination Wrappers
// ------------------------------------------------------------

describe('ContaAzulClient pagination wrapper normalization', () => {
  describe('listCategorias (PT wrapper: itens_totais/itens)', () => {
    it('normalizes itens_totais/itens to { total, items }', async () => {
      server.use(
        http.get(`${API_BASE}/categorias`, () => {
          return HttpResponse.json({
            itens_totais: 165,
            itens: [
              {
                id: 'uuid-1',
                versao: 0,
                nome: 'Aluguel',
                categoria_pai: 'parent-uuid',
                tipo: 'DESPESA',
                entrada_dre: 'DESPESAS_ADMINISTRATIVAS',
                considera_custo_dre: false,
              },
            ],
          });
        }),
      );

      const result = await makeClient().listCategorias();
      expect(result.total).toBe(165);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.nome).toBe('Aluguel');
    });
  });

  describe('listProdutos (EN wrapper: totalItems/items)', () => {
    it('normalizes totalItems/items to { total, items }', async () => {
      server.use(
        http.get(`${API_BASE}/produtos`, () => {
          return HttpResponse.json({
            totalItems: 2909,
            items: [
              {
                id: 'uuid-prod',
                id_legado: 123,
                nome: 'Camiseta Test',
                codigo: 'SKU-1',
                tipo: 'PRODUTO',
                status: 'ATIVO',
                saldo: 10,
                valor_venda: 199.9,
                custo_medio: 50,
                ean: '',
              },
            ],
          });
        }),
      );

      const result = await makeClient().listProdutos({ tamanhoPagina: 10 });
      expect(result.total).toBe(2909);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.codigo).toBe('SKU-1');
    });

    it('sends tamanho_pagina query param', async () => {
      let capturedUrl: URL | null = null;

      server.use(
        http.get(`${API_BASE}/produtos`, ({ request }) => {
          capturedUrl = new URL(request.url);
          return HttpResponse.json({ totalItems: 0, items: [] });
        }),
      );

      await makeClient().listProdutos({ tamanhoPagina: 200 });
      expect(capturedUrl!.searchParams.get('tamanho_pagina')).toBe('200');
    });
  });

  describe('listPessoas (EN wrapper: totalItems/items)', () => {
    it('normalizes totalItems/items and preserves perfis arrays', async () => {
      server.use(
        http.get(`${API_BASE}/pessoas`, () => {
          return HttpResponse.json({
            totalItems: 7778,
            items: [
              {
                id: 'pessoa-uuid',
                nome: 'Test Customer',
                documento: '12345678900',
                email: 'x@y.z',
                telefone: '',
                ativo: true,
                id_legado: 0,
                uuid_legado: '',
                perfis: ['Cliente'],
                tipo_pessoa: 'Física',
              },
            ],
          });
        }),
      );

      const result = await makeClient().listPessoas({ tamanhoPagina: 100 });
      expect(result.total).toBe(7778);
      expect(result.items[0]!.perfis).toEqual(['Cliente']);
    });
  });

  describe('listNotasFiscais (bare wrapper: itens only)', () => {
    it('normalizes bare itens wrapper with total = null', async () => {
      server.use(
        http.get(`${API_BASE}/notas-fiscais`, () => {
          return HttpResponse.json({
            itens: [
              {
                data_emissao: '2026-04-10T17:42:39.007Z',
                nome_destinatario: 'Fake Customer',
                numero_nota: 3763,
                chave_acesso: '29260430938298000146550010000037631416089300',
                status: 'EMITIDA',
              },
            ],
          });
        }),
      );

      const result = await makeClient().listNotasFiscais({
        dataInicial: '2026-04-01',
        dataFinal: '2026-04-11',
      });

      expect(result.total).toBeNull();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.numero_nota).toBe(3763);
    });

    it('sends data_inicial and data_final as required query params', async () => {
      let capturedUrl: URL | null = null;

      server.use(
        http.get(`${API_BASE}/notas-fiscais`, ({ request }) => {
          capturedUrl = new URL(request.url);
          return HttpResponse.json({ itens: [] });
        }),
      );

      await makeClient().listNotasFiscais({
        dataInicial: '2026-04-01',
        dataFinal: '2026-04-11',
        tamanhoPagina: 50,
      });

      expect(capturedUrl!.searchParams.get('data_inicial')).toBe('2026-04-01');
      expect(capturedUrl!.searchParams.get('data_final')).toBe('2026-04-11');
      expect(capturedUrl!.searchParams.get('tamanho_pagina')).toBe('50');
    });
  });
});

// ------------------------------------------------------------
// Error mapping
// ------------------------------------------------------------

describe('ContaAzulClient error mapping', () => {
  it('maps 401 to UnauthorizedError', async () => {
    server.use(
      http.get(`${API_BASE}/produtos`, () => {
        return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }),
    );

    await expect(makeClient().listProdutos()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('maps 404 to NotFoundError', async () => {
    server.use(
      http.get(`${API_BASE}/produtos`, () => {
        return HttpResponse.json(
          { error: { message: 'URL não corresponde a recurso' } },
          { status: 404 },
        );
      }),
    );

    await expect(makeClient().listProdutos()).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps 400 to HttpError (validation / missing params)', async () => {
    server.use(
      http.get(`${API_BASE}/notas-fiscais`, () => {
        return HttpResponse.json(
          { error: 'Campos obrigatórios não informados' },
          { status: 400 },
        );
      }),
    );

    try {
      await makeClient().listNotasFiscais({
        dataInicial: '2026-04-01',
        dataFinal: '2026-04-11',
      });
      expect.fail('Expected HttpError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(400);
    }
  });

  it('throws ValidationError when the response wrapper is missing required fields', async () => {
    server.use(
      http.get(`${API_BASE}/produtos`, () => {
        return HttpResponse.json({ wrong: 'shape' });
      }),
    );

    await expect(makeClient().listProdutos()).rejects.toBeInstanceOf(ValidationError);
  });
});
