import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { GoogleGmailApi, loadConfig } from '@merit/infrastructure';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = loadConfig();
  if (config.GOOGLE_OAUTH_CLIENT_ID === undefined) {
    return NextResponse.json({ error: 'Google sign-in is not configured.' }, { status: 503 });
  }

  const state = randomUUID();
  const response = NextResponse.redirect(
    GoogleGmailApi.composeAuthUrl({
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      clientId: config.GOOGLE_OAUTH_CLIENT_ID,
      redirectUri: config.GOOGLE_AUTH_REDIRECT_URI,
      scope: 'openid email profile',
      state,
    }),
  );
  response.cookies.set({
    name: 'merit_oauth_state',
    value: state,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/google/callback',
    maxAge: 10 * 60,
  });
  return response;
}
