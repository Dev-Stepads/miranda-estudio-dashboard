import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

const SESSION_COOKIE = 'miranda_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Simple in-memory rate limiter: max 5 failed attempts per IP per 15 min
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now > entry.resetAt) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    failedAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count++;
  }
}

function getCredentials(): { login: string; password: string } {
  const login = process.env.DASHBOARD_LOGIN;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!login || !password) {
    throw new Error(
      'Missing DASHBOARD_LOGIN or DASHBOARD_PASSWORD in environment. ' +
      'Check your .env.local file.',
    );
  }
  return { login, password };
}

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
 * Verify a session token's HMAC signature.
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

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: 'Muitas tentativas. Aguarde 15 minutos.' },
      { status: 429 },
    );
  }

  let body: { login?: string; password?: string };
  try {
    body = await request.json() as { login?: string; password?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  }

  const { login, password } = body;
  if (!login || !password) {
    recordFailedAttempt(ip);
    return NextResponse.json({ ok: false, error: 'Credenciais incorretas' }, { status: 401 });
  }

  const creds = getCredentials();

  const loginMatch = login.length === creds.login.length &&
    crypto.timingSafeEqual(Buffer.from(login), Buffer.from(creds.login));
  const passMatch = password.length === creds.password.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(creds.password));

  if (loginMatch && passMatch) {
    const token = createSessionToken(creds.password);

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    });

    return NextResponse.json({ ok: true });
  }

  recordFailedAttempt(ip);
  return NextResponse.json({ ok: false, error: 'Credenciais incorretas' }, { status: 401 });
}
