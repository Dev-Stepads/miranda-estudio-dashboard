/**
 * Tests for Conta Azul OAuth helpers and ContaAzulTokenManager.
 *
 * Focus: prove the single-use refresh_token rotation works and the
 * onRefresh callback fires every time.
 */

import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../setup.ts';
import {
  basicAuthHeader,
  exchangeCodeForTokens,
  refreshAccessToken,
  ContaAzulTokenManager,
} from '../../../src/integrations/conta-azul/auth.ts';
import { HttpError, ValidationError } from '../../../src/lib/errors.ts';

const TOKEN_URL = 'https://auth.contaazul.com/oauth2/token';

const FAKE_CREDS = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
};

// base64("test-client-id:test-client-secret")
const EXPECTED_AUTH = `Basic ${Buffer.from('test-client-id:test-client-secret').toString('base64')}`;

// ------------------------------------------------------------
// basicAuthHeader
// ------------------------------------------------------------

describe('basicAuthHeader', () => {
  it('encodes client_id:client_secret as base64 with "Basic " prefix', () => {
    const result = basicAuthHeader('abc', 'xyz');
    expect(result).toBe(`Basic ${Buffer.from('abc:xyz').toString('base64')}`);
  });

  it('handles unicode in the secret', () => {
    const result = basicAuthHeader('user', 'sênha-ç');
    const decoded = Buffer.from(result.replace('Basic ', ''), 'base64').toString('utf8');
    expect(decoded).toBe('user:sênha-ç');
  });
});

// ------------------------------------------------------------
// exchangeCodeForTokens
// ------------------------------------------------------------

describe('exchangeCodeForTokens', () => {
  it('POSTs form-encoded body and parses the token response', async () => {
    let capturedAuth: string | null = null;
    let capturedContentType: string | null = null;
    let capturedBody: string | null = null;

    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        capturedAuth = request.headers.get('Authorization');
        capturedContentType = request.headers.get('Content-Type');
        capturedBody = await request.text();
        return HttpResponse.json({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          id_token: 'id-token-jwt',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }),
    );

    const result = await exchangeCodeForTokens({
      credentials: FAKE_CREDS,
      code: 'auth-code-123',
      redirectUri: 'https://example.com/callback',
    });

    expect(capturedAuth).toBe(EXPECTED_AUTH);
    expect(capturedContentType).toBe('application/x-www-form-urlencoded');
    expect(capturedBody).toContain('grant_type=authorization_code');
    expect(capturedBody).toContain('code=auth-code-123');
    expect(capturedBody).toContain(
      `redirect_uri=${encodeURIComponent('https://example.com/callback')}`,
    );

    expect(result.access_token).toBe('new-access-token');
    expect(result.refresh_token).toBe('new-refresh-token');
    expect(result.expires_in).toBe(3600);
  });

  it('throws HttpError on non-2xx response', async () => {
    server.use(
      http.post(TOKEN_URL, () => {
        return HttpResponse.json({ error: 'invalid_grant' }, { status: 400 });
      }),
    );

    try {
      await exchangeCodeForTokens({
        credentials: FAKE_CREDS,
        code: 'bad-code',
        redirectUri: 'https://example.com',
      });
      expect.fail('Expected HttpError');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(400);
    }
  });

  it('throws ValidationError when response body is missing required fields', async () => {
    server.use(
      http.post(TOKEN_URL, () => {
        return HttpResponse.json({ not_a_token: true });
      }),
    );

    await expect(
      exchangeCodeForTokens({
        credentials: FAKE_CREDS,
        code: 'x',
        redirectUri: 'https://example.com',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ------------------------------------------------------------
// refreshAccessToken
// ------------------------------------------------------------

describe('refreshAccessToken', () => {
  it('POSTs form-encoded body with grant_type=refresh_token', async () => {
    let capturedBody: string | null = null;

    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        capturedBody = await request.text();
        return HttpResponse.json({
          access_token: 'refreshed-access',
          refresh_token: 'rotated-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }),
    );

    const result = await refreshAccessToken({
      credentials: FAKE_CREDS,
      refreshToken: 'old-refresh',
    });

    expect(capturedBody).toContain('grant_type=refresh_token');
    expect(capturedBody).toContain('refresh_token=old-refresh');

    // The NEW refresh_token must be different — that's the rotation.
    expect(result.refresh_token).toBe('rotated-refresh');
    expect(result.refresh_token).not.toBe('old-refresh');
  });
});

// ------------------------------------------------------------
// ContaAzulTokenManager
// ------------------------------------------------------------

describe('ContaAzulTokenManager', () => {
  it('calls refreshAccessToken on first getAccessToken when no cached token', async () => {
    server.use(
      http.post(TOKEN_URL, () => {
        return HttpResponse.json({
          access_token: 'fresh-token',
          refresh_token: 'new-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }),
    );

    const manager = new ContaAzulTokenManager({
      ...FAKE_CREDS,
      refreshToken: 'initial-refresh',
    });

    const token = await manager.getAccessToken();
    expect(token).toBe('fresh-token');
  });

  it('returns the cached access_token without refreshing if still valid', async () => {
    let callCount = 0;

    server.use(
      http.post(TOKEN_URL, () => {
        callCount++;
        return HttpResponse.json({
          access_token: 'fresh-token',
          refresh_token: 'new-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }),
    );

    const manager = new ContaAzulTokenManager({
      ...FAKE_CREDS,
      refreshToken: 'initial-refresh',
      accessToken: 'already-valid-token',
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h in future
    });

    const t1 = await manager.getAccessToken();
    const t2 = await manager.getAccessToken();

    expect(t1).toBe('already-valid-token');
    expect(t2).toBe('already-valid-token');
    expect(callCount).toBe(0); // no refresh happened
  });

  it('refreshes when the cached access_token is expired', async () => {
    let callCount = 0;

    server.use(
      http.post(TOKEN_URL, () => {
        callCount++;
        return HttpResponse.json({
          access_token: 'fresh-token',
          refresh_token: 'new-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }),
    );

    const manager = new ContaAzulTokenManager({
      ...FAKE_CREDS,
      refreshToken: 'initial-refresh',
      accessToken: 'stale-token',
      accessTokenExpiresAt: new Date(Date.now() - 1000), // 1 second in past
    });

    const token = await manager.getAccessToken();
    expect(token).toBe('fresh-token');
    expect(callCount).toBe(1);
  });

  it('fires onRefresh callback with the new tokens every time it rotates', async () => {
    server.use(
      http.post(TOKEN_URL, () => {
        return HttpResponse.json({
          access_token: 'callback-access',
          refresh_token: 'callback-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }),
    );

    const onRefresh = vi.fn();

    const manager = new ContaAzulTokenManager({
      ...FAKE_CREDS,
      refreshToken: 'initial-refresh',
      onRefresh,
    });

    await manager.getAccessToken();

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        newAccessToken: 'callback-access',
        newRefreshToken: 'callback-refresh',
        expiresAt: expect.any(Date),
      }),
    );
  });

  it('rotates the in-memory refresh_token (so next call uses the new one)', async () => {
    let receivedRefreshTokens: string[] = [];

    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        const body = await request.text();
        const match = body.match(/refresh_token=([^&]+)/);
        if (match !== null && match[1] !== undefined) {
          receivedRefreshTokens.push(decodeURIComponent(match[1]));
        }
        return HttpResponse.json({
          access_token: `access-${receivedRefreshTokens.length}`,
          refresh_token: `refresh-${receivedRefreshTokens.length + 1}`,
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }),
    );

    const manager = new ContaAzulTokenManager({
      ...FAKE_CREDS,
      refreshToken: 'initial',
    });

    await manager.refresh(); // forces refresh #1
    await manager.refresh(); // forces refresh #2 — MUST use the new token

    expect(receivedRefreshTokens).toEqual(['initial', 'refresh-2']);
    // And the manager's current refresh token should now be refresh-3
    expect(manager.getCurrentRefreshToken()).toBe('refresh-3');
  });

  it('awaits async onRefresh callbacks before returning', async () => {
    server.use(
      http.post(TOKEN_URL, () => {
        return HttpResponse.json({
          access_token: 'x',
          refresh_token: 'y',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }),
    );

    let callbackCompleted = false;
    const manager = new ContaAzulTokenManager({
      ...FAKE_CREDS,
      refreshToken: 'initial',
      onRefresh: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        callbackCompleted = true;
      },
    });

    await manager.refresh();
    expect(callbackCompleted).toBe(true);
  });
});
