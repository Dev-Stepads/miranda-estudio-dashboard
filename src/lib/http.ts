import {
  HttpError,
  IntegrationError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  type IntegrationSource,
} from './errors.ts';

/**
 * Typed wrapper around the global `fetch` that normalizes error handling
 * into the IntegrationError hierarchy. Each integration client should
 * compose this with its own base URL and auth headers.
 *
 * Features:
 * - Abort on timeout (default 30s).
 * - Automatic JSON parsing when Content-Type matches.
 * - Error classes mapped from HTTP status codes.
 * - Network errors wrapped in HttpError with status=0.
 *
 * NOT included (intentionally, keep it small):
 * - Retry/backoff — add at a higher layer if needed for 429/5xx.
 * - Rate limiting budget — enforce at the scheduler, not here.
 * - Request signing — each integration handles its own auth.
 */

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  /** Request timeout in milliseconds. Default 30_000. */
  timeoutMs?: number;
}

export interface FetchResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchJson<T = unknown>(
  url: string,
  options: FetchOptions,
  source: IntegrationSource,
): Promise<FetchResponse<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const finalHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
    if (body !== undefined && !('Content-Type' in finalHeaders)) {
      finalHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    // Parse body defensively. Some endpoints return empty body on 204.
    const contentType = response.headers.get('content-type') ?? '';
    const parsedBody: unknown = contentType.includes('application/json')
      ? await safeJsonParse(response)
      : await safeTextParse(response);

    if (!response.ok) {
      throw mapHttpError(response.status, source, url, parsedBody, response.headers);
    }

    return {
      status: response.status,
      headers: response.headers,
      body: parsedBody as T,
    };
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    if (isAbortError(error)) {
      throw new HttpError(
        `Request timeout after ${timeoutMs}ms`,
        source,
        0,
        undefined,
        error,
      );
    }
    throw new HttpError(
      `Network error: ${error instanceof Error ? error.message : String(error)}`,
      source,
      0,
      undefined,
      error,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function mapHttpError(
  status: number,
  source: IntegrationSource,
  url: string,
  body: unknown,
  headers: Headers,
): HttpError {
  if (status === 401) return new UnauthorizedError(source, body);
  if (status === 404) return new NotFoundError(source, url, body);
  if (status === 429) {
    const retryAfter = headers.get('retry-after');
    const retryMs = retryAfter ? Number(retryAfter) * 1000 : 60_000;
    return new RateLimitError(source, Number.isFinite(retryMs) ? retryMs : 60_000, body);
  }
  return new HttpError(`HTTP ${status}`, source, status, body);
}

async function safeJsonParse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function safeTextParse(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
