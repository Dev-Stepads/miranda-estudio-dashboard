/**
 * Meta Ads rate-limit helper — parses the Business Use Case (BUC) header
 * and exposes a "should I slow down?" signal.
 *
 * Meta returns `X-Business-Use-Case-Usage` as a JSON string keyed by
 * business ID, e.g.:
 *
 *   { "<business_id>": [{
 *       "type": "ads_insights",
 *       "call_count": 72,
 *       "total_cputime": 15,
 *       "total_time": 20,
 *       "estimated_time_to_regain_access": 0
 *   }] }
 *
 * `call_count`, `total_cputime`, and `total_time` are PERCENTAGES of the
 * quota (0-100). When any of them crosses 80 we back off. When the header
 * reports `estimated_time_to_regain_access > 0`, we're already throttled
 * and must sleep for that many minutes.
 *
 * There's also `X-Ad-Account-Usage` with the same shape keyed by account;
 * we aggregate the worst of both.
 *
 * Source: developers.facebook.com/docs/graph-api/overview/rate-limiting/
 */

export interface RateLimitUsage {
  /** 0-100 — percentage of call quota used. */
  callCount: number;
  /** 0-100 — CPU time used. */
  totalCpuTime: number;
  /** 0-100 — wall time used. */
  totalTime: number;
  /** Seconds until the throttle clears. 0 when not throttled. */
  estimatedRegainSeconds: number;
}

export interface RateLimitDecision {
  usage: RateLimitUsage;
  /** True if we should pause before making another call. */
  shouldBackoff: boolean;
  /** Suggested sleep in ms (0 when we don't need to sleep). */
  sleepMs: number;
}

/** Start backing off when ANY usage metric exceeds this threshold. */
const BACKOFF_THRESHOLD_PERCENT = 80;
/** Default pause when we're near the threshold but not yet throttled. */
const PRECAUTIONARY_SLEEP_MS = 2000;

export function parseRateLimitHeaders(headers: Headers): RateLimitDecision {
  const buc = safeParseHeader(headers.get('x-business-use-case-usage'));
  const aau = safeParseHeader(headers.get('x-ad-account-usage'));

  const usage = mergeWorstCase(buc, aau);

  // Hard throttle: Meta told us exactly how long to wait.
  if (usage.estimatedRegainSeconds > 0) {
    return {
      usage,
      shouldBackoff: true,
      sleepMs: usage.estimatedRegainSeconds * 1000,
    };
  }

  // Soft throttle: we're close to the limit, pause briefly.
  const maxUsage = Math.max(usage.callCount, usage.totalCpuTime, usage.totalTime);
  if (maxUsage >= BACKOFF_THRESHOLD_PERCENT) {
    return { usage, shouldBackoff: true, sleepMs: PRECAUTIONARY_SLEEP_MS };
  }

  return { usage, shouldBackoff: false, sleepMs: 0 };
}

// ------------------------------------------------------------
// Internals
// ------------------------------------------------------------

interface RawBucEntry {
  call_count?: number;
  total_cputime?: number;
  total_time?: number;
  estimated_time_to_regain_access?: number;
}

function safeParseHeader(value: string | null): RawBucEntry[] {
  if (value === null || value === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object') return [];

    // Both headers have the same shape — value can be either a flat
    // RawBucEntry (x-ad-account-usage) or a dict-of-arrays keyed by
    // business ID (x-business-use-case-usage).
    if (Array.isArray(parsed)) return parsed as RawBucEntry[];

    const entries: RawBucEntry[] = [];
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) entries.push(...(v as RawBucEntry[]));
      else if (v !== null && typeof v === 'object') entries.push(v as RawBucEntry);
    }
    return entries;
  } catch {
    return [];
  }
}

function mergeWorstCase(...groups: RawBucEntry[][]): RateLimitUsage {
  let callCount = 0;
  let totalCpuTime = 0;
  let totalTime = 0;
  let estimatedRegainSeconds = 0;

  for (const group of groups) {
    for (const entry of group) {
      callCount = Math.max(callCount, entry.call_count ?? 0);
      totalCpuTime = Math.max(totalCpuTime, entry.total_cputime ?? 0);
      totalTime = Math.max(totalTime, entry.total_time ?? 0);
      estimatedRegainSeconds = Math.max(
        estimatedRegainSeconds,
        entry.estimated_time_to_regain_access ?? 0,
      );
    }
  }

  return { callCount, totalCpuTime, totalTime, estimatedRegainSeconds };
}
