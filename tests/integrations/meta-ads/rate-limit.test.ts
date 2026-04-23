import { describe, it, expect } from 'vitest';
import { parseRateLimitHeaders } from '../../../src/integrations/meta-ads/rate-limit.ts';

/** Helper to create a Headers object with optional rate-limit headers. */
function makeHeaders(opts?: {
  buc?: string;
  aau?: string;
}): Headers {
  const h = new Headers();
  if (opts?.buc) h.set('x-business-use-case-usage', opts.buc);
  if (opts?.aau) h.set('x-ad-account-usage', opts.aau);
  return h;
}

describe('parseRateLimitHeaders', () => {
  describe('no headers present', () => {
    it('returns no backoff when headers are empty', () => {
      const result = parseRateLimitHeaders(new Headers());
      expect(result.shouldBackoff).toBe(false);
      expect(result.sleepMs).toBe(0);
      expect(result.usage.callCount).toBe(0);
      expect(result.usage.totalCpuTime).toBe(0);
      expect(result.usage.totalTime).toBe(0);
      expect(result.usage.estimatedRegainMinutes).toBe(0);
    });
  });

  describe('low usage (under threshold)', () => {
    it('returns no backoff when usage is low', () => {
      const buc = JSON.stringify({
        '123': [{
          type: 'ads_insights',
          call_count: 20,
          total_cputime: 10,
          total_time: 15,
          estimated_time_to_regain_access: 0,
        }],
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc }));
      expect(result.shouldBackoff).toBe(false);
      expect(result.sleepMs).toBe(0);
      expect(result.usage.callCount).toBe(20);
      expect(result.usage.totalCpuTime).toBe(10);
      expect(result.usage.totalTime).toBe(15);
    });

    it('returns no backoff at exactly 79%', () => {
      const buc = JSON.stringify({
        '123': [{ call_count: 79, total_cputime: 50, total_time: 50, estimated_time_to_regain_access: 0 }],
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc }));
      expect(result.shouldBackoff).toBe(false);
      expect(result.sleepMs).toBe(0);
    });
  });

  describe('high usage (precautionary backoff)', () => {
    it('triggers backoff when call_count >= 80', () => {
      const buc = JSON.stringify({
        '123': [{ call_count: 85, total_cputime: 10, total_time: 10, estimated_time_to_regain_access: 0 }],
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc }));
      expect(result.shouldBackoff).toBe(true);
      expect(result.sleepMs).toBe(2000); // precautionary sleep
    });

    it('triggers backoff when total_cputime >= 80', () => {
      const buc = JSON.stringify({
        '123': [{ call_count: 10, total_cputime: 80, total_time: 10, estimated_time_to_regain_access: 0 }],
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc }));
      expect(result.shouldBackoff).toBe(true);
      expect(result.sleepMs).toBe(2000);
    });

    it('triggers backoff when total_time >= 80', () => {
      const buc = JSON.stringify({
        '123': [{ call_count: 10, total_cputime: 10, total_time: 95, estimated_time_to_regain_access: 0 }],
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc }));
      expect(result.shouldBackoff).toBe(true);
      expect(result.sleepMs).toBe(2000);
    });

    it('uses worst case across both headers', () => {
      const buc = JSON.stringify({
        '123': [{ call_count: 50, total_cputime: 50, total_time: 50, estimated_time_to_regain_access: 0 }],
      });
      const aau = JSON.stringify({
        'act_456': [{ call_count: 90, total_cputime: 10, total_time: 10, estimated_time_to_regain_access: 0 }],
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc, aau }));
      expect(result.shouldBackoff).toBe(true);
      expect(result.usage.callCount).toBe(90); // worst case from aau
    });
  });

  describe('hard throttle (estimated_time_to_regain_access)', () => {
    it('sleeps for the estimated regain time in minutes', () => {
      const buc = JSON.stringify({
        '123': [{ call_count: 100, total_cputime: 100, total_time: 100, estimated_time_to_regain_access: 2 }],
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc }));
      expect(result.shouldBackoff).toBe(true);
      expect(result.sleepMs).toBe(2 * 60 * 1000); // 2 minutes in ms
      expect(result.usage.estimatedRegainMinutes).toBe(2);
    });

    it('caps sleep at 5 minutes maximum', () => {
      const buc = JSON.stringify({
        '123': [{ call_count: 100, total_cputime: 100, total_time: 100, estimated_time_to_regain_access: 30 }],
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc }));
      expect(result.shouldBackoff).toBe(true);
      expect(result.sleepMs).toBe(5 * 60 * 1000); // 5 min cap
    });

    it('prioritizes hard throttle over precautionary backoff', () => {
      const buc = JSON.stringify({
        '123': [{ call_count: 85, total_cputime: 85, total_time: 85, estimated_time_to_regain_access: 1 }],
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc }));
      // Hard throttle takes precedence — sleepMs should be 1 minute, not 2s precautionary
      expect(result.sleepMs).toBe(1 * 60 * 1000);
    });
  });

  describe('malformed / edge-case headers', () => {
    it('handles empty string header gracefully', () => {
      const h = new Headers();
      h.set('x-business-use-case-usage', '');
      const result = parseRateLimitHeaders(h);
      expect(result.shouldBackoff).toBe(false);
      expect(result.sleepMs).toBe(0);
    });

    it('handles invalid JSON gracefully', () => {
      const h = new Headers();
      h.set('x-business-use-case-usage', 'not-json{{{');
      const result = parseRateLimitHeaders(h);
      expect(result.shouldBackoff).toBe(false);
      expect(result.sleepMs).toBe(0);
    });

    it('handles null JSON value gracefully', () => {
      const h = new Headers();
      h.set('x-business-use-case-usage', 'null');
      const result = parseRateLimitHeaders(h);
      expect(result.shouldBackoff).toBe(false);
      expect(result.sleepMs).toBe(0);
    });

    it('handles JSON array format (x-ad-account-usage style)', () => {
      const aau = JSON.stringify([
        { call_count: 85, total_cputime: 10, total_time: 10, estimated_time_to_regain_access: 0 },
      ]);
      const result = parseRateLimitHeaders(makeHeaders({ aau }));
      expect(result.shouldBackoff).toBe(true);
      expect(result.usage.callCount).toBe(85);
    });

    it('handles missing fields in entries (defaults to 0)', () => {
      const buc = JSON.stringify({
        '123': [{ type: 'ads_insights' }], // no numeric fields
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc }));
      expect(result.shouldBackoff).toBe(false);
      expect(result.usage.callCount).toBe(0);
      expect(result.usage.totalCpuTime).toBe(0);
      expect(result.usage.totalTime).toBe(0);
    });

    it('handles multiple entries and takes worst case', () => {
      const buc = JSON.stringify({
        '123': [
          { call_count: 30, total_cputime: 10, total_time: 10, estimated_time_to_regain_access: 0 },
          { call_count: 90, total_cputime: 50, total_time: 50, estimated_time_to_regain_access: 0 },
        ],
      });
      const result = parseRateLimitHeaders(makeHeaders({ buc }));
      expect(result.usage.callCount).toBe(90);
      expect(result.shouldBackoff).toBe(true);
    });
  });
});
