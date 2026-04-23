import crypto from 'crypto';

export const SESSION_COOKIE = 'miranda_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Create a signed session token: payload.signature
 * The middleware can verify this without a database round-trip.
 */
export function createSessionToken(secret: string): string {
  const payload = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

/**
 * Verify a session token's HMAC signature (Node.js crypto version).
 */
export function verifySessionToken(token: string, secret: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
