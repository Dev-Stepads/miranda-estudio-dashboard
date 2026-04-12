import { describe, expect, it } from 'vitest';
import { normalizeState } from '../../src/lib/brazil.ts';

describe('normalizeState', () => {
  it('passes through valid 2-letter UF codes (uppercase)', () => {
    expect(normalizeState('BA')).toBe('BA');
    expect(normalizeState('SP')).toBe('SP');
    expect(normalizeState('RJ')).toBe('RJ');
    expect(normalizeState('DF')).toBe('DF');
    expect(normalizeState('AC')).toBe('AC');
    expect(normalizeState('TO')).toBe('TO');
  });

  it('uppercases valid lowercase UF codes', () => {
    expect(normalizeState('ba')).toBe('BA');
    expect(normalizeState('sp')).toBe('SP');
    expect(normalizeState('rj')).toBe('RJ');
  });

  it('maps full state names to UF codes', () => {
    expect(normalizeState('Bahia')).toBe('BA');
    expect(normalizeState('São Paulo')).toBe('SP');
    expect(normalizeState('Rio de Janeiro')).toBe('RJ');
    expect(normalizeState('Minas Gerais')).toBe('MG');
    expect(normalizeState('Distrito Federal')).toBe('DF');
    expect(normalizeState('Pernambuco')).toBe('PE');
    expect(normalizeState('Rio Grande do Sul')).toBe('RS');
    expect(normalizeState('Santa Catarina')).toBe('SC');
    expect(normalizeState('Paraná')).toBe('PR');
  });

  it('handles names without accents', () => {
    expect(normalizeState('Sao Paulo')).toBe('SP');
    expect(normalizeState('Ceara')).toBe('CE');
    expect(normalizeState('Amapa')).toBe('AP');
    expect(normalizeState('Goias')).toBe('GO');
    expect(normalizeState('Maranhao')).toBe('MA');
    expect(normalizeState('Parana')).toBe('PR');
    expect(normalizeState('Rondonia')).toBe('RO');
    expect(normalizeState('Paraiba')).toBe('PB');
    expect(normalizeState('Piaui')).toBe('PI');
    expect(normalizeState('Espirito Santo')).toBe('ES');
  });

  it('is case-insensitive for full names', () => {
    expect(normalizeState('bahia')).toBe('BA');
    expect(normalizeState('BAHIA')).toBe('BA');
    expect(normalizeState('Bahia')).toBe('BA');
    expect(normalizeState('SÃO PAULO')).toBe('SP');
  });

  it('trims whitespace', () => {
    expect(normalizeState('  BA  ')).toBe('BA');
    expect(normalizeState(' Bahia ')).toBe('BA');
  });

  it('returns null for null, undefined, empty', () => {
    expect(normalizeState(null)).toBeNull();
    expect(normalizeState(undefined)).toBeNull();
    expect(normalizeState('')).toBeNull();
    expect(normalizeState('   ')).toBeNull();
  });

  it('returns null for international/unrecognized provinces', () => {
    expect(normalizeState('California')).toBeNull();
    expect(normalizeState('Lisboa')).toBeNull();
    expect(normalizeState('Buenos Aires')).toBeNull();
    expect(normalizeState('XX')).toBeNull();
    expect(normalizeState('ZZ')).toBeNull();
  });

  it('rejects city names that happen to be 2 chars', () => {
    // "AA" is not a valid UF
    expect(normalizeState('AA')).toBeNull();
    // But "AL" (Alagoas) is valid
    expect(normalizeState('AL')).toBe('AL');
  });

  it('handles all 27 UF codes', () => {
    const allUFs = [
      'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO',
      'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR',
      'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
    ];
    for (const uf of allUFs) {
      expect(normalizeState(uf)).toBe(uf);
    }
  });
});
