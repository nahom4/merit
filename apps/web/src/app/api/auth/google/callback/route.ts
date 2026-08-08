import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { fetchGoogleIdentity, loadConfig } from '@merit/infrastructure';
import { users } from '../../../../../composition/container.js';
import { SESSION_COOKIE } from '../../../../../lib/session.js';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const config = loadConfig();
  if (config.GOOGLE_OAUTH_CLIENT_ID === undefined || config.GOOGLE_OAUTH_CLIENT_SECRET === undefined) {
    return NextResponse.json({ error: 'Google sign-in is not configured.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = cookies().get('merit_oauth_state')?.value ?? null;
  if (code === null || state === null || cookieState === null || state !== cookieState) {
    return NextResponse.json({ error: 'Invalid sign-in state.' }, { status: 400 });
  }

  const identity = await fetchGoogleIdentity({
    code,
    clientId: config.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: config.GOOGLE_AUTH_REDIRECT_URI,
  });

  const now = new Date().toISOString();
  const sessionId = randomUUID();
  const repository = users();
  await repository.upsert({ email: identity.email, name: identity.name, now });
  await repository.createSession({ id: sessionId, email: identity.email, now });

  const user = await repository.findBySession(sessionId);
  const organizationId = user?.organizationId ?? null;
  const response = NextResponse.redirect(
    new URL(organizationId === null ? '/' : `/organizations/${organizationId}`, request.url),
  );
  response.cookies.set({
    name: SESSION_COOKIE,
    value: sessionId,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  response.cookies.delete('merit_oauth_state');
  return response;
}
