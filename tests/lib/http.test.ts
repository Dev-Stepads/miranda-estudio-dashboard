import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/lib/http.ts';
import { HttpError, RateLimitError, UnauthorizedError } from '../../src/lib/errors.ts';

describe('withRetry', () => {
  it('returns on successful first attempt without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on RateLimitError and succeeds on second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RateLimitError('meta-ads', 1000))
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, { maxRetries: 3, label: 'test' });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on HttpError with status >= 500', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new HttpError('HTTP 502', 'nuvemshop', 502))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on HttpError with status 0 (network/timeout)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new HttpError('Network error', 'conta-azul', 0))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 401 UnauthorizedError (non-transient)', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new UnauthorizedError('conta-azul'));

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow(UnauthorizedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on HttpError with 400 status', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new HttpError('Bad Request', 'nuvemshop', 400));

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow(HttpError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after max retries exceeded', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new HttpError('HTTP 500', 'meta-ads', 500));

    await expect(withRetry(fn, { maxRetries: 2 })).rejects.toThrow(HttpError);
    // 1 initial + 2 retries = 3 total
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses default maxRetries of 3 when not specified', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new HttpError('HTTP 503', 'nuvemshop', 503));

    await expect(withRetry(fn)).rejects.toThrow(HttpError);
    // 1 initial + 3 retries = 4 total
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('does NOT retry on non-IntegrationError exceptions', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new TypeError('Cannot read property'));

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow(TypeError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries multiple times before succeeding', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new HttpError('HTTP 500', 'meta-ads', 500))
      .mockRejectedValueOnce(new HttpError('HTTP 502', 'meta-ads', 502))
      .mockResolvedValue('finally');

    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe('finally');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
