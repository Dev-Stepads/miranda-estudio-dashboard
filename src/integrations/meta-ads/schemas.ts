/**
 * Zod schemas for Meta Marketing API (Graph API v25.0).
 *
 * Only the fields we actively consume are validated. Everything else passes
 * through untouched so Meta can add fields without breaking the ETL. See
 * MAPEAMENTO_META_ADS.txt §5 for the full source of truth.
 *
 * Key points:
 * - Monetary values come as STRINGS ("1073.65"), not numbers. Parse in the
 *   mapper.
 * - `actions` and `action_values` are arrays of objects where `action_type`
 *   identifies the event. Purchase can come as either "purchase" or
 *   "offsite_conversion.fb_pixel_purchase" depending on Pixel setup.
 * - Nullable/optional is the default stance here — validation errors from
 *   Meta are a recurrent pain in the equivalent Nuvemshop client.
 */

import { z } from 'zod';

// ------------------------------------------------------------
// Actions (conversions)
// ------------------------------------------------------------

/**
 * One entry in the `actions[]` or `action_values[]` arrays.
 * `value` is a string monetary/count field (e.g. "42" or "1234.56").
 */
export const MetaActionSchema = z
  .object({
    action_type: z.string(),
    value: z.string().nullable().optional(),
  })
  .passthrough();

// ------------------------------------------------------------
// Insights row
// ------------------------------------------------------------

/**
 * A single row from /act_<id>/insights — with time_increment=1 (daily
 * granularity) and level ∈ {account, campaign, adset, ad}. Identifying
 * fields only show up at the appropriate level, so they're all optional.
 */
export const MetaInsightsRowSchema = z
  .object({
    date_start: z.string(),
    date_stop: z.string(),
    account_id: z.string().nullable().optional(),
    account_name: z.string().nullable().optional(),
    campaign_id: z.string().nullable().optional(),
    campaign_name: z.string().nullable().optional(),
    adset_id: z.string().nullable().optional(),
    adset_name: z.string().nullable().optional(),
    ad_id: z.string().nullable().optional(),
    ad_name: z.string().nullable().optional(),
    spend: z.string().nullable().optional(),
    impressions: z.string().nullable().optional(),
    reach: z.string().nullable().optional(),
    clicks: z.string().nullable().optional(),
    inline_link_clicks: z.string().nullable().optional(),
    ctr: z.string().nullable().optional(),
    cpc: z.string().nullable().optional(),
    cpm: z.string().nullable().optional(),
    frequency: z.string().nullable().optional(),
    actions: z.array(MetaActionSchema).nullable().optional(),
    action_values: z.array(MetaActionSchema).nullable().optional(),
    purchase_roas: z.array(MetaActionSchema).nullable().optional(),
  })
  .passthrough();

export const MetaInsightsListSchema = z.object({
  data: z.array(MetaInsightsRowSchema),
  paging: z
    .object({
      cursors: z
        .object({
          before: z.string().optional(),
          after: z.string().optional(),
        })
        .optional(),
      next: z.string().optional(),
      previous: z.string().optional(),
    })
    .optional(),
});

// ------------------------------------------------------------
// Ad account metadata
// ------------------------------------------------------------

export const MetaAdAccountSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    account_status: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    timezone_name: z.string().nullable().optional(),
    business: z
      .object({
        id: z.string(),
        name: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

// ------------------------------------------------------------
// Error envelope
// ------------------------------------------------------------

/**
 * Meta returns errors in a specific shape — surfacing it here lets the
 * client distinguish "legit API error" (e.g. throttle) from a network
 * blip without parsing unknown shapes.
 */
export const MetaErrorEnvelopeSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
});
