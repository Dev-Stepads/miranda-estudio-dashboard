import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSessionToken, verifySessionToken, SESSION_MAX_AGE } from '../../app/lib/session.ts';

describe('createSessionToken', () => {
  it('returns a string in payload.timestamp.signature format', () => {
    const token = createSessionToken('test-secret');
    const parts = token.split('.');
    // Format: {hex64}.{timestamp}.{sig64} → 3 dot-separated parts
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
    expect(parts[2]).toBeTruthy();
  });

  it('payload (first segment) is a 64-char hex string (32 random bytes)', () => {
    const token = createSessionToken('test-secret');
    const parts = token.split('.');
    expect(parts[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('second segment is a numeric timestamp', () => {
    const token = createSessionToken('test-secret');
    const parts = token.split('.');
    expect(Number(parts[1])).toBeGreaterThan(0);
    expect(Number.isFinite(Number(parts[1]))).toBe(true);
  });

  it('signature (last segment) is a 64-char hex string (sha256 HMAC)', () => {
    const token = createSessionToken('test-secret');
    const lastDot = token.lastIndexOf('.');
    const signature = token.slice(lastDot + 1);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens on each call', () => {
    const token1 = createSessionToken('test-secret');
    const token2 = createSessionToken('test-secret');
    expect(token1).not.toBe(token2);
  });

  it('produces different signatures with different secrets', () => {
    const token = createSessionToken('secret-a');
    expect(verifySessionToken(token, 'secret-a')).toBe(true);
    expect(verifySessionToken(token, 'secret-b')).toBe(false);
  });
});

describe('verifySessionToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true for a valid token with correct secret', () => {
    const secret = 'my-dashboard-secret';
    const token = createSessionToken(secret);
    expect(verifySessionToken(token, secret)).toBe(true);
  });

  it('returns false for a tampered payload', () => {
    const secret = 'my-dashboard-secret';
    const token = createSessionToken(secret);
    const lastDot = token.lastIndexOf('.');
    const payload = token.slice(0, lastDot);
    const signature = token.slice(lastDot + 1);
    const tampered = payload[0] === 'a' ? 'b' + payload.slice(1) : 'a' + payload.slice(1);
    expect(verifySessionToken(`${tampered}.${signature}`, secret)).toBe(false);
  });

  it('returns false for a tampered signature', () => {
    const secret = 'my-dashboard-secret';
    const token = createSessionToken(secret);
    const lastDot = token.lastIndexOf('.');
    const payload = token.slice(0, lastDot);
    const signature = token.slice(lastDot + 1);
    const tampered = signature[0] === 'a' ? 'b' + signature.slice(1) : 'a' + signature.slice(1);
    expect(verifySessionToken(`${payload}.${tampered}`, secret)).toBe(false);
  });

  it('returns false when using the wrong secret', () => {
    const token = createSessionToken('correct-secret');
    expect(verifySessionToken(token, 'wrong-secret')).toBe(false);
  });

  it('returns false for a token with no dot separator', () => {
    expect(verifySessionToken('nodothere', 'secret')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(verifySessionToken('', 'secret')).toBe(false);
  });

  it('returns false for a token with empty payload', () => {
    expect(verifySessionToken('.abcdef', 'secret')).toBe(false);
  });

  it('returns false for a token with empty signature', () => {
    expect(verifySessionToken('abcdef.', 'secret')).toBe(false);
  });

  it('rejects an expired token (older than SESSION_MAX_AGE)', () => {
    const secret = 'my-dashboard-secret';
    const token = createSessionToken(secret);

    // Mock Date.now to be past the TTL
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + SESSION_MAX_AGE * 1000 + 1);

    expect(verifySessionToken(token, secret)).toBe(false);
  });

  it('accepts a token just within SESSION_MAX_AGE', () => {
    const secret = 'my-dashboard-secret';
    const token = createSessionToken(secret);

    // Mock Date.now to be just before TTL expires
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + SESSION_MAX_AGE * 1000 - 1000);

    expect(verifySessionToken(token, secret)).toBe(true);
  });
});
