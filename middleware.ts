import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const SESSION_COOKIE = 'miranda_session';

function verifySessionToken(token: string, secret: string): boolean {
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

export function middleware(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE);

  if (!session?.value) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const secret = process.env.DASHBOARD_PASSWORD;
  if (!secret) {
    // No secret configured — reject all sessions for safety
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!verifySessionToken(session.value, secret)) {
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
