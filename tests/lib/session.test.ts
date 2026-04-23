import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken } from '../../app/lib/session.ts';

describe('createSessionToken', () => {
  it('returns a string in payload.signature format', () => {
    const token = createSessionToken('test-secret');
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
  });

  it('payload is a 64-char hex string (32 random bytes)', () => {
    const token = createSessionToken('test-secret');
    const [payload] = token.split('.');
    expect(payload).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signature is a 64-char hex string (sha256 HMAC)', () => {
    const token = createSessionToken('test-secret');
    const [, signature] = token.split('.');
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens on each call', () => {
    const token1 = createSessionToken('test-secret');
    const token2 = createSessionToken('test-secret');
    expect(token1).not.toBe(token2);
  });

  it('produces different signatures with different secrets', () => {
    // Since payloads are random, we can't directly compare.
    // But we CAN verify that the same payload signed with different secrets
    // yields different signatures — tested indirectly via verifySessionToken.
    const token = createSessionToken('secret-a');
    expect(verifySessionToken(token, 'secret-a')).toBe(true);
    expect(verifySessionToken(token, 'secret-b')).toBe(false);
  });
});

describe('verifySessionToken', () => {
  it('returns true for a valid token with correct secret', () => {
    const secret = 'my-dashboard-secret';
    const token = createSessionToken(secret);
    expect(verifySessionToken(token, secret)).toBe(true);
  });

  it('returns false for a tampered payload', () => {
    const secret = 'my-dashboard-secret';
    const token = createSessionToken(secret);
    const [payload, signature] = token.split('.');
    // Flip one character in the payload
    const tampered = payload![0] === 'a' ? 'b' + payload!.slice(1) : 'a' + payload!.slice(1);
    expect(verifySessionToken(`${tampered}.${signature}`, secret)).toBe(false);
  });

  it('returns false for a tampered signature', () => {
    const secret = 'my-dashboard-secret';
    const token = createSessionToken(secret);
    const [payload, signature] = token.split('.');
    const tampered = signature![0] === 'a' ? 'b' + signature!.slice(1) : 'a' + signature!.slice(1);
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

  it('returns false for a token with too many parts', () => {
    expect(verifySessionToken('a.b.c', 'secret')).toBe(false);
  });
});
