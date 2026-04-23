/**
 * Meta Marketing API (Graph API) client.
 *
 * Fundamentals:
 * - API version TRAVADA em v25.0 por decisão (ver DECISOES 2026-04-10 D5).
 * - Auth é um System User Token que não expira — ver MAPEAMENTO_META_ADS.txt §1.
 * - Ad account ID SEMPRE com prefixo `act_`.
 * - Todo fetcher respeita os headers de BUC e pausa quando o `call_count`
 *   ultrapassa 80% ou quando `estimated_time_to_regain_access > 0`.
 *
 * Endpoints usados pelo ETL:
 *   GET /act_{id}                                 → metadata da conta
 *   GET /act_{id}/insights?level=campaign&...    → insights por campanha/dia
 *   GET /act_{id}/insights?level=adset&...       → insights por conjunto/dia
 *   GET /act_{id}/insights?level=ad&...          → insights por anúncio/dia
 *
 * Não usamos webhooks — Meta atualiza insights a cada 15 min e webhooks só
 * cobrem eventos de estado (ver decisão D3). Polling a cada 30 min pelo
 * GitHub Actions cron.
 */

import { z } from 'zod';

import { HttpError, RateLimitError, ValidationError } from '../../lib/errors.ts';
import { withRetry } from '../../lib/http.ts';
import {
  MetaInsightsListSchema,
  MetaAdAccountSchema,
  MetaAdListSchema,
} from './schemas.ts';
import type {
  MetaInsightsRow,
  MetaAdAccount,
  MetaLevel,
  MetaAdWithCreative,
} from './types.ts';
import { parseRateLimitHeaders, type RateLimitUsage } from './rate-limit.ts';

const SOURCE = 'meta-ads' as const;
const DEFAULT_API_VERSION = 'v25.0';

/**
 * Default attribution window. Meta removed 7d_view/28d_view in 2026-01-12.
 * Decisão D2 (2026-04-10) — bate com o default atual do Ads Manager.
 */
const DEFAULT_ATTRIBUTION_WINDOWS = ['7d_click', '1d_view'] as const;

/**
 * Fields pedidos no endpoint /insights. Mantidos em uma lista pra fazer
 * diff fácil quando a Meta deprecar campos novos.
 */
const INSIGHTS_FIELDS = [
  'date_start',
  'date_stop',
  'account_id',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'inline_link_clicks',
  'ctr',
  'cpc',
  'cpm',
  'frequency',
  'actions',
  'action_values',
  'purchase_roas',
] as const;

// ------------------------------------------------------------
// Config & types
// ------------------------------------------------------------

export interface MetaAdsClientConfig {
  /** System User Token — não expira. Ver MAPEAMENTO §1. */
  accessToken: string;
  /** Ad account ID com prefixo `act_`. */
  adAccountId: string;
  /** Versão do Graph API. Default v25.0. */
  apiVersion?: string;
}

export interface MetaInsightsOptions {
  level: MetaLevel;
  /** YYYY-MM-DD, inclusivo. */
  since: string;
  /** YYYY-MM-DD, inclusivo. */
  until: string;
  /** `1` = diário, `monthly`, etc. Default 1. */
  timeIncrement?: number | 'monthly';
  /** Page size, default 500 (max 5000 — doc seção 7). */
  limit?: number;
}

export interface MetaListResult<T> {
  items: T[];
  usage: RateLimitUsage;
}

// ------------------------------------------------------------
// Client
// ------------------------------------------------------------

export class MetaAdsClient {
  private readonly accessToken: string;
  private readonly adAccountId: string;
  private readonly baseUrl: string;

  constructor(config: MetaAdsClientConfig) {
    if (!config.adAccountId.startsWith('act_')) {
      throw new Error(
        `META_AD_ACCOUNT_ID must be prefixed with "act_" (got "${config.adAccountId}")`,
      );
    }
    this.accessToken = config.accessToken;
    this.adAccountId = config.adAccountId;
    const version = config.apiVersion ?? DEFAULT_API_VERSION;
    this.baseUrl = `https://graph.facebook.com/${version}`;
  }

  /**
   * Metadata da ad account. Usado no run.ts para validar credenciais antes
   * de disparar sync completo.
   */
  async getAdAccount(): Promise<MetaAdAccount> {
    const url = new URL(`${this.baseUrl}/${this.adAccountId}`);
    url.searchParams.set('fields', 'id,name,account_status,currency,timezone_name,business');
    url.searchParams.set('access_token', this.accessToken);

    const { body } = await this.fetchJson(url.toString());
    return parseWithSchema(MetaAdAccountSchema, body);
  }

  /**
   * Busca TODAS as páginas de insights pra uma janela. Faz backoff
   * automático baseado nos headers de BUC.
   */
  async listInsights(
    options: MetaInsightsOptions,
    log: (msg: string) => void = () => {},
  ): Promise<MetaListResult<MetaInsightsRow>> {
    const url = this.buildInsightsUrl(options);
    const items: MetaInsightsRow[] = [];
    let nextUrl: string | null = url;
    let pageNum = 0;
    let lastUsage: RateLimitUsage = {
      callCount: 0,
      totalCpuTime: 0,
      totalTime: 0,
      estimatedRegainMinutes: 0,
    };

    while (nextUrl !== null) {
      pageNum++;
      const { body, headers } = await this.fetchJson(nextUrl);
      const parsed = parseWithSchema(MetaInsightsListSchema, body);
      items.push(...parsed.data);

      const decision = parseRateLimitHeaders(headers);
      lastUsage = decision.usage;

      log(
        `  [${options.level}] page ${pageNum}: ${parsed.data.length} rows ` +
          `(total ${items.length}, usage call=${decision.usage.callCount}% ` +
          `cpu=${decision.usage.totalCpuTime}% time=${decision.usage.totalTime}%)`,
      );

      if (decision.shouldBackoff) {
        log(`  ⏸ rate limit near cap, sleeping ${decision.sleepMs}ms...`);
        await sleep(decision.sleepMs);
      }

      nextUrl = parsed.paging?.next ?? null;
    }

    return { items, usage: lastUsage };
  }

  /**
   * Lista ads da conta com thumbnail/image do creative. Usado pra
   * popular `meta_ads_creatives` (lookup de thumbnail no ranking).
   *
   * Endpoint: /act_<id>/ads?fields=id,name,creative{thumbnail_url,image_url}
   * Retorna ~100 ads por pagina. Rate limit parser reaproveitado.
   */
  async listAdCreatives(
    log: (msg: string) => void = () => {},
  ): Promise<MetaListResult<MetaAdWithCreative>> {
    const url = new URL(`${this.baseUrl}/${this.adAccountId}/ads`);
    url.searchParams.set('access_token', this.accessToken);
    url.searchParams.set(
      'fields',
      'id,name,creative{id,name,thumbnail_url,image_url}',
    );
    url.searchParams.set('limit', '100');

    const items: MetaAdWithCreative[] = [];
    let nextUrl: string | null = url.toString();
    let pageNum = 0;
    let lastUsage: RateLimitUsage = {
      callCount: 0,
      totalCpuTime: 0,
      totalTime: 0,
      estimatedRegainMinutes: 0,
    };

    while (nextUrl !== null) {
      pageNum++;
      const { body, headers } = await this.fetchJson(nextUrl);
      const parsed = parseWithSchema(MetaAdListSchema, body);
      items.push(...parsed.data);

      const decision = parseRateLimitHeaders(headers);
      lastUsage = decision.usage;

      log(
        `  [creatives] page ${pageNum}: ${parsed.data.length} ads ` +
          `(total ${items.length}, usage call=${decision.usage.callCount}%)`,
      );

      if (decision.shouldBackoff) {
        log(`  ⏸ rate limit near cap, sleeping ${decision.sleepMs}ms...`);
        await sleep(decision.sleepMs);
      }

      nextUrl = parsed.paging?.next ?? null;
    }

    return { items, usage: lastUsage };
  }

  // ------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------

  private buildInsightsUrl(options: MetaInsightsOptions): string {
    const url = new URL(`${this.baseUrl}/${this.adAccountId}/insights`);
    url.searchParams.set('access_token', this.accessToken);
    url.searchParams.set('level', options.level);
    url.searchParams.set('fields', INSIGHTS_FIELDS.join(','));
    url.searchParams.set(
      'time_range',
      JSON.stringify({ since: options.since, until: options.until }),
    );
    url.searchParams.set(
      'time_increment',
      String(options.timeIncrement ?? 1),
    );
    url.searchParams.set(
      'action_attribution_windows',
      JSON.stringify(DEFAULT_ATTRIBUTION_WINDOWS),
    );
    url.searchParams.set('limit', String(options.limit ?? 500));
    return url.toString();
  }

  private async fetchJson(
    url: string,
  ): Promise<{ body: unknown; headers: Headers }> {
    // withRetry handles transient errors (429/5xx) with exponential backoff.
    // We throw RateLimitError (with Meta's recommended 60s cooldown) or
    // HttpError so that withRetry's isTransient check recognizes them.
    return withRetry(
      async () => {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        const contentType = response.headers.get('content-type') ?? '';
        const body: unknown = contentType.includes('application/json')
          ? await safeJson(response)
          : await response.text();

        if (response.ok) {
          return { body, headers: response.headers };
        }

        const message = extractMetaError(body) ?? `HTTP ${response.status}`;

        if (response.status === 429) {
          // Meta recommends waiting ~1 min on rate limit
          throw new RateLimitError(SOURCE, 60_000, body);
        }
        if (response.status >= 500) {
          throw new HttpError(
            `[meta-ads] ${message} — url: ${url.split('?')[0]}`,
            SOURCE,
            response.status,
            body,
          );
        }

        // Non-transient error (4xx other than 429) — throw plain error, won't be retried
        throw new HttpError(
          `[meta-ads] ${message} — url: ${url.split('?')[0]}`,
          SOURCE,
          response.status,
          body,
        );
      },
      { maxRetries: 3, label: 'meta-ads' },
    );
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractMetaError(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const err = (body as { error?: { message?: string; code?: number } }).error;
  if (err === undefined) return null;
  return `${err.message ?? 'unknown error'} (code ${err.code ?? '?'})`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseWithSchema<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(SOURCE, result.error);
  }
  return result.data;
}
