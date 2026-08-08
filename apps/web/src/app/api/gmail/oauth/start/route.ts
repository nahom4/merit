import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { GoogleGmailApi, loadConfig } from '@merit/infrastructure';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = loadConfig();
  // The watch topic is not required to connect: without one the mailbox is synced on demand.
  if (config.GOOGLE_OAUTH_CLIENT_ID === undefined || config.GOOGLE_GMAIL_REDIRECT_URI === undefined) {
    return NextResponse.json({ error: 'Gmail OAuth is not configured.' }, { status: 503 });
  }

  const state = randomUUID();
  const response = NextResponse.redirect(
    GoogleGmailApi.composeAuthUrl({
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      clientId: config.GOOGLE_OAUTH_CLIENT_ID,
      redirectUri: config.GOOGLE_GMAIL_REDIRECT_URI,
      // Calendar as well as Gmail: the follow-up reminders go on the same person's calendar,
      // and asking twice for one feature is two consent screens for no reason.
      scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events',
      state,
    }),
  );

  response.cookies.set({
    name: 'gmail_oauth_state',
    value: state,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/gmail/oauth/callback',
    maxAge: 10 * 60,
  });
  return response;
}
