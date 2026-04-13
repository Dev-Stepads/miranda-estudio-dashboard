/**
 * Meta Ads raw types — derived from Zod schemas (never edit manually).
 *
 * See schemas.ts for the source of truth and MAPEAMENTO_META_ADS.txt
 * §5 for what each field means.
 */

import type { z } from 'zod';
import type {
  MetaActionSchema,
  MetaInsightsRowSchema,
  MetaInsightsListSchema,
  MetaAdAccountSchema,
} from './schemas.ts';

export type MetaAction = z.infer<typeof MetaActionSchema>;
export type MetaInsightsRow = z.infer<typeof MetaInsightsRowSchema>;
export type MetaInsightsList = z.infer<typeof MetaInsightsListSchema>;
export type MetaAdAccount = z.infer<typeof MetaAdAccountSchema>;

export type MetaLevel = 'account' | 'campaign' | 'adset' | 'ad';

/**
 * Canonical shape we insert into `meta_ads_insights`. Matches the
 * schema in `20260411120000_initial_schema.sql` exactly.
 */
export interface CanonicalMetaInsight {
  date: string; // YYYY-MM-DD
  level: 'campaign' | 'adset' | 'ad';
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
}
