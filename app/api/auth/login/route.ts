import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

const VALID_LOGIN = 'mirandaestudio';
const VALID_PASSWORD = 'DashMiranda@14';
const SESSION_COOKIE = 'miranda_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(request: NextRequest) {
  const body = await request.json() as { login?: string; password?: string };
  const { login, password } = body;

  if (login === VALID_LOGIN && password === VALID_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');

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

  return NextResponse.json({ ok: false, error: 'Credenciais incorretas' }, { status: 401 });
}
