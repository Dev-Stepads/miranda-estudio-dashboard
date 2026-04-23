import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'miranda_session';

/** Hex-encode an ArrayBuffer. */
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Timing-safe string comparison (constant-time for equal-length strings). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Verify session token HMAC using Web Crypto API (Edge-compatible). */
async function verifySessionToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!payload || !signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expected = toHex(sig);

  return timingSafeEqual(expected, signature);
}

export async function middleware(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE);

  if (!session?.value) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // No secret configured — reject all sessions for safety
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!(await verifySessionToken(session.value, secret))) {
    // Invalid or tampered token — clear cookie and redirect
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
