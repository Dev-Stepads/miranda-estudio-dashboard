/**
 * Pure function tests for Conta Azul mappers.
 */

import { describe, expect, it } from 'vitest';

import {
  isContaAzulCustomer,
  mapPessoaToCanonicalCustomer,
  mapNotaFiscalStatus,
} from '../../../src/integrations/conta-azul/mapper.ts';
import type {
  RawContaAzulPessoa,
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

