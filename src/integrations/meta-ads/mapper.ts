/**
 * Mapper: raw Meta insights row → canonical shape that matches the
 * `meta_ads_insights` table.
 *
 * Two things deserve attention:
 *
 * 1. **Monetary / numeric fields come as STRINGS.** Meta returns
 *    `spend: "1073.65"` not `1073.65`. parseFloat is correct here.
 *    Empty or missing fields default to 0.
 *
 * 2. **Purchases come from the `actions[]` array.** Depending on Pixel
 *    setup, the action_type can be one of:
 *      - "purchase"                                     (default)
 *      - "offsite_conversion.fb_pixel_purchase"         (most common Nuvemshop setup)
 *      - "omni_purchase"                                (unified events)
 *      - "onsite_web_purchase"                          (older)
 *    We sum values from ALL of these to avoid missing conversions on
 *    mixed setups. Gap M#5 no mapping doc.
 */

import type { MetaAction, MetaInsightsRow, CanonicalMetaInsight } from './types.ts';

/**
 * Action types that count as "purchase" for this project.
 * If Miranda's Pixel uses a different event name, add it here.
 */
const PURCHASE_ACTION_TYPES = new Set([
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'omni_purchase',
  'onsite_web_purchase',
  'web_in_store_purchase',
]);

export function mapInsightToCanonical(
  raw: MetaInsightsRow,
  level: 'campaign' | 'adset' | 'ad',
): CanonicalMetaInsight | null {
  // Without a campaign_id we can't satisfy the NOT NULL constraint on
  // the canonical table. Meta never returns a campaign-level row without
  // the campaign_id, but defensive check anyway.
  if (raw.campaign_id === null || raw.campaign_id === undefined || raw.campaign_id === '') {
    return null;
  }

  const purchases = sumActionsByType(raw.actions ?? [], PURCHASE_ACTION_TYPES);
  const purchaseValue = sumActionsByType(raw.action_values ?? [], PURCHASE_ACTION_TYPES);

  return {
    date: raw.date_start,
    level,
    campaign_id: raw.campaign_id,
    campaign_name: raw.campaign_name ?? null,
    adset_id: raw.adset_id ?? null,
    adset_name: raw.adset_name ?? null,
    ad_id: raw.ad_id ?? null,
    ad_name: raw.ad_name ?? null,
    spend: parseNumeric(raw.spend),
    impressions: Math.round(parseNumeric(raw.impressions)),
    reach: Math.round(parseNumeric(raw.reach)),
    clicks: Math.round(parseNumeric(raw.clicks)),
    purchases: Math.round(purchases),
    purchase_value: purchaseValue,
  };
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function parseNumeric(value: string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumActionsByType(
  actions: MetaAction[],
  types: Set<string>,
): number {
  let total = 0;
  for (const action of actions) {
    if (!types.has(action.action_type)) continue;
    total += parseNumeric(action.value);
  }
  return total;
}
