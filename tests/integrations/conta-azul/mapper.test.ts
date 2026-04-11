/**
 * Pure function tests for Conta Azul mappers.
 */

import { describe, expect, it } from 'vitest';

import {
  isContaAzulCustomer,
  mapPessoaToCanonicalCustomer,
  mapProdutoToCanonicalProduct,
  mapContaAzulProdutoVariacoes,
  mapNotaFiscalToPartialSale,
  mapNotaFiscalStatus,
} from '../../../src/integrations/conta-azul/mapper.ts';
import type {
  RawContaAzulPessoa,
  RawContaAzulProduto,
  RawContaAzulNotaFiscal,
} from '../../../src/integrations/conta-azul/types.ts';

// ------------------------------------------------------------
// Fixture builders
// ------------------------------------------------------------

function makePessoa(overrides: Partial<RawContaAzulPessoa> = {}): RawContaAzulPessoa {
  return {
    id: 'a079baca-6fc3-4a73-96ff-605917bf0ecb',
    nome: 'Maria Test',
    documento: '12345678900',
    email: 'maria@example.com',
    telefone: '+5571999999999',
    ativo: true,
    id_legado: 0,
    uuid_legado: '00000000-0000-0000-0000-000000000000',
    perfis: ['Cliente'],
    tipo_pessoa: 'Física',
    data_criacao: '2026-01-15T10:00:00',
    data_alteracao: '2026-01-15T10:00:00',
    ...overrides,
  };
}

function makeProduto(overrides: Partial<RawContaAzulProduto> = {}): RawContaAzulProduto {
  return {
    id: 'cb579bb9-2a76-4c3b-ac4c-82f068bf57b4',
    id_legado: 436658926,
    nome: 'Camiseta Confia Na Bahia',
    codigo: 'MIR0285',
    tipo: 'PRODUCT_VARIATION',
    status: 'ATIVO',
    saldo: 0,
    valor_venda: 250,
    custo_medio: 39.44,
    ean: '',
    ultima_atualizacao: '2025-11-20T19:37:32.87609Z',
    produtos_variacao: [
      {
        id: '6db726cd-ea11-4467-a092-2ed611c574fa',
        id_legado: 436658929,
        nome: 'Camiseta Confia Na Bahia (Cappuccino)',
        codigo: 'MIR0285CAP',
        ean: '2000089000005',
        tipo: 'PRODUTO',
        status: 'ATIVO',
        saldo: 18,
        valor_venda: 250,
        custo_medio: 39.44245,
        id_produto_pai_variacao: 'cb579bb9-2a76-4c3b-ac4c-82f068bf57b4',
      },
      {
        id: '18957523-22af-442e-92b6-9cbb15dd30f6',
        id_legado: 436658927,
        nome: 'Camiseta Confia Na Bahia (Preto)',
        codigo: 'MIR0285PRE',
        ean: '2000028000004',
        tipo: 'PRODUTO',
        status: 'ATIVO',
        saldo: 21,
        valor_venda: 210,
        custo_medio: 35.88,
        id_produto_pai_variacao: 'cb579bb9-2a76-4c3b-ac4c-82f068bf57b4',
      },
    ],
    ...overrides,
  };
}

function makeNotaFiscal(
  overrides: Partial<RawContaAzulNotaFiscal> = {},
): RawContaAzulNotaFiscal {
  return {
    data_emissao: '2026-04-10T17:42:39.007Z',
    nome_destinatario: 'Test Customer',
    numero_nota: 3763,
    chave_acesso: '29260430938298000146550010000037631416089300',
    status: 'EMITIDA',
    ...overrides,
  };
}

// ------------------------------------------------------------
// isContaAzulCustomer
// ------------------------------------------------------------

describe('isContaAzulCustomer', () => {
  it('accepts pessoas with perfis containing "Cliente"', () => {
    expect(isContaAzulCustomer(makePessoa({ perfis: ['Cliente'] }))).toBe(true);
  });

  it('accepts pessoas with multiple perfis including "Cliente"', () => {
    expect(isContaAzulCustomer(makePessoa({ perfis: ['Cliente', 'Fornecedor'] }))).toBe(
      true,
    );
  });

  it('rejects fornecedores', () => {
    expect(isContaAzulCustomer(makePessoa({ perfis: ['Fornecedor'] }))).toBe(false);
  });

  it('rejects transportadoras', () => {
    expect(isContaAzulCustomer(makePessoa({ perfis: ['Transportadora'] }))).toBe(false);
  });

  it('rejects funcionários', () => {
    expect(isContaAzulCustomer(makePessoa({ perfis: ['Funcionário'] }))).toBe(false);
  });

  it('rejects empty perfis arrays', () => {
    expect(isContaAzulCustomer(makePessoa({ perfis: [] }))).toBe(false);
  });

  it('is case-sensitive (must be exactly "Cliente")', () => {
    expect(isContaAzulCustomer(makePessoa({ perfis: ['cliente'] }))).toBe(false);
    expect(isContaAzulCustomer(makePessoa({ perfis: ['CLIENTE'] }))).toBe(false);
  });
});

// ------------------------------------------------------------
// mapPessoaToCanonicalCustomer
// ------------------------------------------------------------

describe('mapPessoaToCanonicalCustomer', () => {
  it('produces a canonical customer with correct source and id', () => {
    const result = mapPessoaToCanonicalCustomer(makePessoa());
    expect(result.source).toBe('conta_azul');
    expect(result.source_id).toBe('a079baca-6fc3-4a73-96ff-605917bf0ecb');
  });

  it('always maps gender to unknown (Conta Azul never provides it)', () => {
    const result = mapPessoaToCanonicalCustomer(makePessoa());
    expect(result.gender).toBe('unknown');
    expect(result.age).toBeNull();
    expect(result.age_range).toBe('unknown');
  });

  it('always nulls state and city (list endpoint has no address)', () => {
    const result = mapPessoaToCanonicalCustomer(makePessoa());
    expect(result.state).toBeNull();
    expect(result.city).toBeNull();
  });

  it('nulls out empty PII strings', () => {
    const result = mapPessoaToCanonicalCustomer(
      makePessoa({ email: '', telefone: '', documento: '' }),
    );
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.document).toBeNull();
  });

  it('preserves non-empty PII strings', () => {
    const result = mapPessoaToCanonicalCustomer(makePessoa());
    expect(result.email).toBe('maria@example.com');
    expect(result.phone).toBe('+5571999999999');
    expect(result.document).toBe('12345678900');
  });
});

// ------------------------------------------------------------
// mapProdutoToCanonicalProduct
// ------------------------------------------------------------

describe('mapProdutoToCanonicalProduct', () => {
  it('maps the basic fields from the parent product', () => {
    const result = mapProdutoToCanonicalProduct(makeProduto());
    expect(result.source).toBe('conta_azul');
    expect(result.source_id).toBe('cb579bb9-2a76-4c3b-ac4c-82f068bf57b4');
    expect(result.name).toBe('Camiseta Confia Na Bahia');
  });

  it('uses `codigo` as sku (NOT `ean`)', () => {
    const result = mapProdutoToCanonicalProduct(makeProduto());
    expect(result.sku).toBe('MIR0285');
  });

  it('nulls out empty sku', () => {
    const result = mapProdutoToCanonicalProduct(makeProduto({ codigo: '' }));
    expect(result.sku).toBeNull();
  });

  it('uses `valor_venda` as price (already a number)', () => {
    const result = mapProdutoToCanonicalProduct(makeProduto({ valor_venda: 299.9 }));
    expect(result.price).toBe(299.9);
    expect(typeof result.price).toBe('number');
  });
});

describe('mapContaAzulProdutoVariacoes', () => {
  it('maps each variation to its own canonical product', () => {
    const results = mapContaAzulProdutoVariacoes(makeProduto());
    expect(results).toHaveLength(2);
    expect(results[0]!.source_id).toBe('6db726cd-ea11-4467-a092-2ed611c574fa');
    expect(results[0]!.sku).toBe('MIR0285CAP');
    expect(results[0]!.price).toBe(250);
    expect(results[1]!.source_id).toBe('18957523-22af-442e-92b6-9cbb15dd30f6');
    expect(results[1]!.sku).toBe('MIR0285PRE');
    expect(results[1]!.price).toBe(210);
  });

  it('returns empty array when produtos_variacao is missing', () => {
    const result = mapContaAzulProdutoVariacoes(makeProduto({ produtos_variacao: undefined }));
    expect(result).toEqual([]);
  });

  it('returns empty array when produtos_variacao is an empty array', () => {
    const result = mapContaAzulProdutoVariacoes(makeProduto({ produtos_variacao: [] }));
    expect(result).toEqual([]);
  });
});

// ------------------------------------------------------------
// mapNotaFiscalStatus
// ------------------------------------------------------------

describe('mapNotaFiscalStatus', () => {
  it('maps "EMITIDA" to paid', () => {
    expect(mapNotaFiscalStatus('EMITIDA')).toBe('paid');
  });

  it('maps "CORRIGIDA COM SUCESSO" to paid (corrected NF-e)', () => {
    expect(mapNotaFiscalStatus('CORRIGIDA COM SUCESSO')).toBe('paid');
  });

  it('maps "CANCELADA" to cancelled', () => {
    expect(mapNotaFiscalStatus('CANCELADA')).toBe('cancelled');
  });

  it('defaults unknown statuses to pending', () => {
    expect(mapNotaFiscalStatus('REJEITADA')).toBe('pending');
    expect(mapNotaFiscalStatus('')).toBe('pending');
  });
});

// ------------------------------------------------------------
// mapNotaFiscalToPartialSale
// ------------------------------------------------------------

describe('mapNotaFiscalToPartialSale', () => {
  it('builds a partial sale with __partial discriminator', () => {
    const result = mapNotaFiscalToPartialSale(makeNotaFiscal());
    expect(result.__partial).toBe(true);
    expect(result.source).toBe('conta_azul');
  });

  it('uses chave_acesso as source_id (stable unique identifier)', () => {
    const result = mapNotaFiscalToPartialSale(makeNotaFiscal());
    expect(result.source_id).toBe('29260430938298000146550010000037631416089300');
    expect(result.chave_acesso).toBe(result.source_id);
  });

  it('preserves numero_nota for reference', () => {
    const result = mapNotaFiscalToPartialSale(makeNotaFiscal());
    expect(result.numero_nota).toBe(3763);
  });

  it('maps valid ISO dates as-is', () => {
    const result = mapNotaFiscalToPartialSale(makeNotaFiscal());
    expect(result.sale_date).toBe('2026-04-10T17:42:39.007Z');
  });

  it('nulls out the "0001-01-01" placeholder date', () => {
    const result = mapNotaFiscalToPartialSale(
      makeNotaFiscal({ data_emissao: '0001-01-01T00:00:00Z' }),
    );
    expect(result.sale_date).toBeNull();
  });

  it('maps status via mapNotaFiscalStatus', () => {
    expect(mapNotaFiscalToPartialSale(makeNotaFiscal({ status: 'EMITIDA' })).status).toBe('paid');
    expect(mapNotaFiscalToPartialSale(makeNotaFiscal({ status: 'CANCELADA' })).status).toBe(
      'cancelled',
    );
  });

  it('preserves customer_name as-is (PII is raw)', () => {
    const result = mapNotaFiscalToPartialSale(makeNotaFiscal({ nome_destinatario: 'Fulano de Tal' }));
    expect(result.customer_name).toBe('Fulano de Tal');
  });
});
