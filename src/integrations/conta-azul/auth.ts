/**
 * Conta Azul OAuth 2.0 helpers.
 *
 * ⚠ CRITICAL: the refresh_token is SINGLE-USE. Each call to
 *   `refreshAccessToken()` returns a NEW refresh_token that MUST
 *   replace the previous one. Failing to persist the new one within
 *   2 weeks results in a broken integration.
 *
 * This module provides two things:
 *
 * 1. Stateless helpers `exchangeCodeForTokens()` and
 *    `refreshAccessToken()` — raw token endpoint calls. Useful for
 *    scripts and initial app authorization.
 *
 * 2. `ContaAzulTokenManager` class — holds the current access_token
 *    in memory, auto-refreshes when expired, and calls back to a
 *    persistence function every time a new refresh_token is issued.
 *    The persistence callback is the caller's responsibility (could
 *    be Supabase, .env.local, a secret manager, etc.).
 *
 * The token endpoint is https://auth.contaazul.com/oauth2/token and
 * expects Basic auth with base64(client_id:client_secret). See
 * MAPEAMENTO_CONTA_AZUL.txt §1 and the live-exploration Appendix §A2.
 */

import { HttpError, ValidationError } from '../../lib/errors.ts';
import { ContaAzulTokenResponseSchema } from './schemas.ts';
import type { ContaAzulTokenResponse } from './types.ts';

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const SOURCE = 'conta-azul' as const;
const TOKEN_ENDPOINT = 'https://auth.contaazul.com/oauth2/token';

/** Safety margin before expiry — refresh this many seconds before the clock runs out. */
const REFRESH_MARGIN_SECONDS = 120;

// ------------------------------------------------------------
// Stateless token helpers
// ------------------------------------------------------------

export interface ContaAzulOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Encode client_id:client_secret as Basic Auth header value.
 * Public for tests; callers typically don't need it directly.
 */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  const encoded = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Exchange an authorization_code (from the OAuth redirect) for a
 * fresh access_token + refresh_token pair.
 *
 * Called exactly ONCE per app authorization — the result's
 * `refresh_token` then bootstraps `refreshAccessToken()` for all
 * subsequent access_token renewals.
 */
export async function exchangeCodeForTokens(params: {
  credentials: ContaAzulOAuthCredentials;
  code: string;
  redirectUri: string;
}): Promise<ContaAzulTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
  });

  return postTokenEndpoint(params.credentials, body);
}

/**
 * Use a refresh_token to get a new access_token (and a new
 * refresh_token, since refresh tokens are SINGLE-USE).
 *
 * The caller MUST immediately persist the returned `refresh_token`
 * — the previous one is now invalid.
 */
export async function refreshAccessToken(params: {
  credentials: ContaAzulOAuthCredentials;
  refreshToken: string;
}): Promise<ContaAzulTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  });

  return postTokenEndpoint(params.credentials, body);
}

/**
 * Direct POST to /oauth2/token with form-encoded body.
 *
 * We bypass `fetchJson` here because the wrapper is JSON-focused
 * (it stringifies the body as JSON), and this endpoint expects
 * `application/x-www-form-urlencoded`. Going direct is 15 lines
 * and avoids contaminating the shared wrapper with a special case.
 */
async function postTokenEndpoint(
  credentials: ContaAzulOAuthCredentials,
  body: URLSearchParams,
): Promise<ContaAzulTokenResponse> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(credentials.clientId, credentials.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new HttpError(
      `Network error contacting token endpoint: ${err instanceof Error ? err.message : String(err)}`,
      SOURCE,
      0,
      undefined,
      err,
    );
  }

  const parsedBody: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new HttpError(
      `Token endpoint returned ${response.status}`,
      SOURCE,
      response.status,
      parsedBody,
    );
  }

  const validated = ContaAzulTokenResponseSchema.safeParse(parsedBody);
  if (!validated.success) {
    throw new ValidationError(SOURCE, validated.error);
  }
  return validated.data;
}

// ------------------------------------------------------------
// Stateful token manager
// ------------------------------------------------------------

/**
 * Callback fired every time a new (access_token, refresh_token) pair
 * is received. The caller MUST persist `newRefreshToken` — the old
 * one is now invalid.
 *
 * This callback is how you connect the token manager to your secret
 * storage (Supabase row, .env.local, 1Password, etc.).
 */
export type PersistTokensCallback = (tokens: {
  newAccessToken: string;
  newRefreshToken: string;
  expiresAt: Date;
}) => void | Promise<void>;

export interface ContaAzulTokenManagerConfig extends ContaAzulOAuthCredentials {
  /** Current refresh_token — seed value on construction. */
  refreshToken: string;
  /** Optional: current access_token, if known (skips first refresh). */
  accessToken?: string;
  /** Optional: when the known access_token expires (Date). */
  accessTokenExpiresAt?: Date;
  /** Called after every successful refresh. Persist here. */
  onRefresh?: PersistTokensCallback;
}

/**
 * Holds and rotates Conta Azul OAuth tokens.
 *
 * Usage:
 * ```ts
 * const manager = new ContaAzulTokenManager({
 *   clientId,
 *   clientSecret,
 *   refreshToken: loadFromVault(),
 *   onRefresh: async (t) => saveToVault(t.newRefreshToken),
 * });
 *
 * const accessToken = await manager.getAccessToken();
 * // Use accessToken for HTTP calls to api-v2.contaazul.com
 * ```
 *
 * Thread-safety: uses an internal mutex so concurrent calls to
 * `getAccessToken()` are safe — only the first caller triggers the
 * refresh, and subsequent callers wait for the same promise.
 */
export class ContaAzulTokenManager {
  private readonly credentials: ContaAzulOAuthCredentials;
  private refreshToken: string;
  private accessToken: string | null;
  private expiresAt: Date | null;
  private readonly onRefresh: PersistTokensCallback | null;
  /** Mutex: if a refresh is in flight, other callers await the same promise. */
  private refreshPromise: Promise<void> | null = null;

  constructor(config: ContaAzulTokenManagerConfig) {
    this.credentials = { clientId: config.clientId, clientSecret: config.clientSecret };
    this.refreshToken = config.refreshToken;
    this.accessToken = config.accessToken ?? null;
    this.expiresAt = config.accessTokenExpiresAt ?? null;
    this.onRefresh = config.onRefresh ?? null;
  }

  /**
   * Return a valid access_token, refreshing if necessary. Also
   * rotates and persists the refresh_token when a refresh happens.
   * Safe for concurrent calls — only one refresh executes at a time.
   */
  async getAccessToken(): Promise<string> {
    if (this.accessToken !== null && this.isFresh()) {
      return this.accessToken;
    }
    // If a refresh is already in flight, wait for it instead of starting a second one
    if (this.refreshPromise) {
      await this.refreshPromise;
    } else {
      await this.refresh();
    }
    // `refresh()` guarantees accessToken is non-null on success.
    return this.accessToken!;
  }

  /**
   * Current refresh_token. Exposed for diagnostics and for the
   * initial bootstrap flow — DO NOT persist this value to storage
   * other than via the onRefresh callback.
   */
  getCurrentRefreshToken(): string {
    return this.refreshToken;
  }

  /**
   * Force a token refresh regardless of expiry. Useful on 401 from
   * the API (access_token invalidated early).
   */
  async refresh(): Promise<void> {
    // Mutex: prevent concurrent refreshes from consuming the single-use token twice
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }
    this.refreshPromise = this.doRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<void> {
    const response = await refreshAccessToken({
      credentials: this.credentials,
      refreshToken: this.refreshToken,
    });

    this.accessToken = response.access_token;
    this.refreshToken = response.refresh_token;
    // `expires_in` is seconds; subtract margin so we refresh early.
    const expiresInMs = (response.expires_in - REFRESH_MARGIN_SECONDS) * 1000;
    this.expiresAt = new Date(Date.now() + Math.max(expiresInMs, 0));

    if (this.onRefresh !== null) {
      await this.onRefresh({
        newAccessToken: response.access_token,
        newRefreshToken: response.refresh_token,
        expiresAt: this.expiresAt,
      });
    }
  }

  private isFresh(): boolean {
    if (this.expiresAt === null) return false;
    return this.expiresAt.getTime() > Date.now();
  }
}
