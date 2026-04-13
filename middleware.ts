import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'miranda_session';

export function middleware(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE);

  if (!session?.value) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
