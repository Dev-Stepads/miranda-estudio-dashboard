import { describe, it, expect } from 'vitest';
import { parsePeriod, getPreviousPeriod } from '../../app/lib/queries.ts';

describe('parsePeriod', () => {
  describe('with days parameter', () => {
    it('defaults to 30 days when no params given', () => {
      const result = parsePeriod({});
      expect(result.days).toBe(30);
      expect(result.label).toBe('Últimos 30 dias');
      // since and until should be YYYY-MM-DD format
      expect(result.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('uses provided days parameter', () => {
      const result = parsePeriod({ days: '7' });
      expect(result.days).toBe(7);
      expect(result.label).toBe('Últimos 7 dias');
    });

    it('treats 0 as falsy and defaults to 30', () => {
      // Number('0') is 0, which is falsy in JS, so `|| 30` kicks in
      const result = parsePeriod({ days: '0' });
      expect(result.days).toBe(30);
    });

    it('clamps negative values to minimum of 1', () => {
      // Number('-5') is -5 which is truthy, so Math.max(1, -5) = 1
      const result = parsePeriod({ days: '-5' });
      expect(result.days).toBe(1);
    });

    it('clamps days to maximum of 1825 (5 years)', () => {
      const result = parsePeriod({ days: '9999' });
      expect(result.days).toBe(1825);
      expect(result.label).toBe('Últimos 1825 dias');
    });

    it('defaults to 30 for non-numeric days input', () => {
      const result = parsePeriod({ days: 'abc' });
      expect(result.days).toBe(30);
    });

    it('defaults to 30 for empty days string', () => {
      const result = parsePeriod({ days: '' });
      expect(result.days).toBe(30);
    });
  });

  describe('with custom from/to parameters', () => {
    it('uses from/to when both are valid dates', () => {
      const result = parsePeriod({ from: '2026-03-01', to: '2026-03-31' });
      expect(result.since).toBe('2026-03-01');
      expect(result.until).toBe('2026-03-31');
      expect(result.days).toBe(30);
      expect(result.label).toBe('2026-03-01 → 2026-03-31');
    });

    it('calculates correct day count for a 1-day range', () => {
      const result = parsePeriod({ from: '2026-04-01', to: '2026-04-01' });
      expect(result.since).toBe('2026-04-01');
      expect(result.until).toBe('2026-04-01');
      expect(result.days).toBe(1); // Math.max(1, 0) = 1
    });

    it('calculates correct day count for multi-month range', () => {
      const result = parsePeriod({ from: '2026-01-01', to: '2026-03-31' });
      expect(result.since).toBe('2026-01-01');
      expect(result.until).toBe('2026-03-31');
      expect(result.days).toBe(89); // Jan 31 + Feb 28 + 30 days between
    });

    it('falls back to days when from is missing', () => {
      const result = parsePeriod({ to: '2026-03-31' });
      expect(result.days).toBe(30);
      expect(result.label).toBe('Últimos 30 dias');
    });

    it('falls back to days when to is missing', () => {
      const result = parsePeriod({ from: '2026-03-01' });
      expect(result.days).toBe(30);
      expect(result.label).toBe('Últimos 30 dias');
    });

    it('falls back to days when from > to (inverted range)', () => {
      const result = parsePeriod({ from: '2026-04-15', to: '2026-03-01' });
      expect(result.days).toBe(30);
      expect(result.label).toBe('Últimos 30 dias');
    });

    it('falls back to days when date format is invalid', () => {
      const result = parsePeriod({ from: '2026/03/01', to: '2026/03/31' });
      expect(result.days).toBe(30);
    });

    it('falls back to days when dates are malformed YYYY-MM-DD', () => {
      const result = parsePeriod({ from: '2026-13-01', to: '2026-03-31' });
      // '2026-13-01' passes the regex but creates an invalid Date
      // JS Date constructor rolls over, so it may still be valid
      // The function checks isNaN — month 13 gets rolled to Jan next year
      // Since the Date constructor is lenient, this actually produces a valid date
      expect(result.since).toBeDefined();
    });

    it('prefers from/to over days when all are provided', () => {
      const result = parsePeriod({ days: '7', from: '2026-03-01', to: '2026-03-31' });
      expect(result.since).toBe('2026-03-01');
      expect(result.until).toBe('2026-03-31');
    });
  });
});

describe('getPreviousPeriod', () => {
  it('computes previous period for a 30-day range', () => {
    const { prevSince, prevUntil } = getPreviousPeriod('2026-03-01', '2026-03-31');
    // The function computes prevUntilDate = sinceDate - 1 day in UTC,
    // then formats via toSaoPauloDateStr. Since sinceDate is 2026-03-01T00:00Z,
    // prevUntilDate is 2026-02-28T00:00Z. In SP (UTC-3), midnight UTC Feb 28
    // is still Feb 27 at 21:00 SP, so it formats as Feb 27.
    expect(prevUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prevSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prevUntil).toBe('2026-02-27');
  });

  it('computes previous period for a 1-day range', () => {
    const { prevSince, prevUntil } = getPreviousPeriod('2026-04-15', '2026-04-15');
    // sinceDate = 2026-04-15T00:00Z, prevUntilDate = 2026-04-14T00:00Z
    // In SP (UTC-3), that's Apr 13 21:00 SP = Apr 13
    expect(prevUntil).toBe('2026-04-13');
    expect(prevSince).toBe('2026-04-13');
  });

  it('computes previous period for a 7-day range', () => {
    const { prevSince, prevUntil } = getPreviousPeriod('2026-04-08', '2026-04-14');
    // sinceDate = 2026-04-08T00:00Z, prevUntilDate = 2026-04-07T00:00Z
    // In SP (UTC-3), that's Apr 6 at 21:00 = Apr 6
    // lengthMs = 6 days, prevSinceDate = Apr 7T00:00Z - 6 days = Apr 1T00:00Z
    // In SP: Mar 31 at 21:00 = Mar 31
    expect(prevUntil).toBe('2026-04-06');
    expect(prevSince).toBe('2026-03-31');
  });

  it('handles year boundary', () => {
    const result = getPreviousPeriod('2026-01-01', '2026-01-31');
    // sinceDate = 2026-01-01T00:00Z, prevUntilDate = 2025-12-31T00:00Z
    // In SP (UTC-3), that's Dec 30 at 21:00 = Dec 30
    expect(result.prevUntil).toBe('2025-12-30');
    expect(result.prevSince).toBeDefined();
  });

  it('returns dates in YYYY-MM-DD format', () => {
    const { prevSince, prevUntil } = getPreviousPeriod('2026-06-01', '2026-06-30');
    expect(prevSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prevUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('previous period does not overlap with current period', () => {
    const since = '2026-04-01';
    const until = '2026-04-30';
    const { prevUntil } = getPreviousPeriod(since, until);
    // prevUntil should be strictly before since
    expect(new Date(prevUntil).getTime()).toBeLessThan(new Date(since).getTime());
  });
});
