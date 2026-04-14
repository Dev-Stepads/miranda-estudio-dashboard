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
 * Purchase action types in PRIORITY ORDER (first match wins).
 *
 * Meta returns the SAME purchase event under multiple aliases
 * simultaneously (purchase, omni_purchase, offsite_conversion.fb_pixel_purchase,
 * etc.) — all with identical values. Summing them causes 5x overcount.
 *
 * We pick the FIRST matching type found in the array, which gives us
 * exactly one count per purchase event. "purchase" is the canonical
 * type returned by Meta in 2026; the others are fallbacks in case
 * Miranda's Pixel setup only emits a non-canonical type.
 */
const PURCHASE_ACTION_PRIORITY = [
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'omni_purchase',
  'onsite_web_purchase',
  'web_in_store_purchase',
];

/**
 * Lead action priority. Same rationale as PURCHASE_ACTION_PRIORITY —
 * Meta emite o mesmo evento sob varios aliases; a gente pega o
 * primeiro match pra nao inflar contagem.
 */
const LEAD_ACTION_PRIORITY = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'onsite_web_lead',
];

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

  const purchases = pickFirstActionByPriority(raw.actions ?? [], PURCHASE_ACTION_PRIORITY);
  const purchaseValue = pickFirstActionByPriority(raw.action_values ?? [], PURCHASE_ACTION_PRIORITY);
  const leads = pickFirstActionByPriority(raw.actions ?? [], LEAD_ACTION_PRIORITY);
  const leadsValue = pickFirstActionByPriority(raw.action_values ?? [], LEAD_ACTION_PRIORITY);

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
    leads: Math.round(leads),
    leads_value: leadsValue,
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

/**
 * Find the FIRST action type (by priority) that exists in the actions
 * array and return its numeric value. This avoids double-counting when
 * Meta returns the same event under multiple aliases.
 */
function pickFirstActionByPriority(
  actions: MetaAction[],
  priorityTypes: string[],
): number {
  for (const type of priorityTypes) {
    const found = actions.find((a) => a.action_type === type);
    if (found) return parseNumeric(found.value);
  }
  return 0;
}
