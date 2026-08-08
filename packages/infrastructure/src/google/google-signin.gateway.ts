import { z } from 'zod';

const TokenSchema = z.object({ access_token: z.string() });
const UserInfoSchema = z.object({ email: z.string().email(), name: z.string().default('') });

export interface GoogleIdentity {
  readonly email: string;
  readonly name: string;
}

/**
 * Sign-in only: swap the authorization code for the person's email address, nothing else.
 * No tokens are stored — the mailbox connection in `gmail-api.gateway.ts` is a separate grant.
 */
export const fetchGoogleIdentity = async (input: {
  readonly code: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}): Promise<GoogleIdentity> => {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google token exchange returned ${tokenResponse.status}: ${await tokenResponse.text()}`);
  }
  const { access_token: accessToken } = TokenSchema.parse(await tokenResponse.json());

  const infoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!infoResponse.ok) {
    throw new Error(`Google userinfo returned ${infoResponse.status}: ${await infoResponse.text()}`);
  }
  const info = UserInfoSchema.parse(await infoResponse.json());
  return { email: info.email, name: info.name === '' ? info.email : info.name };
};
