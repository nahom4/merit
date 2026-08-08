import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { loadConfig } from '@merit/infrastructure';
import { gmailApi, gmailConnections } from '../../../../../composition/container.js';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const config = loadConfig();
  if (
    config.GOOGLE_OAUTH_CLIENT_ID === undefined ||
    config.GOOGLE_OAUTH_CLIENT_SECRET === undefined ||
    config.GOOGLE_GMAIL_REDIRECT_URI === undefined
  ) {
    return NextResponse.json({ error: 'Gmail OAuth is not configured.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const cookieState = cookies().get('gmail_oauth_state')?.value ?? null;

  if (error !== null) {
    return NextResponse.json({ error }, { status: 400 });
  }
  if (state === null || code === null || cookieState === null || state !== cookieState) {
    return NextResponse.json({ error: 'Invalid Gmail OAuth state.' }, { status: 400 });
  }

  const gmail = gmailApi();
  const token = await gmail.exchangeAuthorizationCode({
    code,
    clientId: config.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: config.GOOGLE_GMAIL_REDIRECT_URI,
  });
  if (!token.ok) return NextResponse.json({ error: token.error.message }, { status: 502 });
  if (token.value.refreshToken === null) {
    return NextResponse.json({ error: 'Google did not return a refresh token.' }, { status: 502 });
  }

  const profile = await gmail.getProfile(token.value.accessToken);
  if (!profile.ok) return NextResponse.json({ error: profile.error.message }, { status: 502 });

  // With a topic, Gmail pushes changes and the watch's history id is the starting cursor.
  // Without one, the mailbox's own current position is — same cursor, asked for rather than sent.
  const topicName = config.GOOGLE_GMAIL_WATCH_TOPIC_NAME ?? null;
  const watch =
    topicName === null ? null : await gmail.watchMailbox({ accessToken: token.value.accessToken, topicName });
  if (watch !== null && !watch.ok) {
    return NextResponse.json({ error: watch.error.message }, { status: 502 });
  }
  const startingHistoryId = watch === null ? profile.value.historyId : watch.value.historyId;

  const now = new Date().toISOString();
  const saved = await gmailConnections().saveConnection({
    accountId: 'primary',
    emailAddress: profile.value.emailAddress,
    accessToken: token.value.accessToken,
    refreshToken: token.value.refreshToken,
    tokenType: token.value.tokenType,
    scope: token.value.scope,
    accessTokenExpiresAt: new Date(Date.now() + token.value.expiresInSeconds * 1000).toISOString(),
    watchExpiration: watch === null ? null : watch.value.expiration,
    watchTopicName: topicName,
    lastSyncedHistoryId: startingHistoryId,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (!saved.ok) return NextResponse.json({ error: saved.error.message }, { status: 500 });

  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.delete('gmail_oauth_state');
  return response;
}
