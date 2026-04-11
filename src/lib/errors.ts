/**
 * Error hierarchy for data-source integrations.
 *
 * Every HTTP failure in a client should be normalized into one of these
 * classes so that callers can do `instanceof` checks without parsing
 * raw fetch responses.
 */

export type IntegrationSource = 'nuvemshop' | 'conta-azul' | 'meta-ads';

/**
 * Base class for every error thrown by an integration client.
 * Use this for catch-all handling.
 */
export class IntegrationError extends Error {
  public readonly source: IntegrationSource;
  public override readonly cause?: unknown;

  constructor(message: string, source: IntegrationSource, cause?: unknown) {
    super(message);
    this.name = 'IntegrationError';
    this.source = source;
    this.cause = cause;
  }
}

/**
 * Thrown when the HTTP response status is >= 400.
 * Subclasses add semantic meaning for 401/404/429.
 */
export class HttpError extends IntegrationError {
  public readonly status: number;
  public readonly body: unknown;

  constructor(
    message: string,
    source: IntegrationSource,
    status: number,
    body?: unknown,
    cause?: unknown,
  ) {
    super(message, source, cause);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/**
 * 401 — access token invalid, expired, or revoked.
 * Caller should trigger a refresh_token flow (Conta Azul) or
 * re-prompt the user to reinstall the app (Nuvemshop).
 */
export class UnauthorizedError extends HttpError {
  constructor(source: IntegrationSource, body?: unknown) {
    super('Unauthorized — token invalid or expired', source, 401, body);
    this.name = 'UnauthorizedError';
  }
}

/**
 * 404 — resource not found.
 */
export class NotFoundError extends HttpError {
  public readonly resource: string;

  constructor(source: IntegrationSource, resource: string, body?: unknown) {
    super(`Not found: ${resource}`, source, 404, body);
    this.name = 'NotFoundError';
    this.resource = resource;
  }
}

/**
 * 429 — rate limit exceeded.
 * `retryAfterMs` is the caller's hint for when to retry.
 */
export class RateLimitError extends HttpError {
  public readonly retryAfterMs: number;

  constructor(source: IntegrationSource, retryAfterMs: number, body?: unknown) {
    super(`Rate limited — retry in ${retryAfterMs}ms`, source, 429, body);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown when the API response body does not match the expected Zod schema.
 * Indicates that the upstream API has changed its contract.
 */
export class ValidationError extends IntegrationError {
  public readonly zodError: unknown;

  constructor(source: IntegrationSource, zodError: unknown) {
    super('API response did not match expected schema', source);
    this.name = 'ValidationError';
    this.zodError = zodError;
  }
}
