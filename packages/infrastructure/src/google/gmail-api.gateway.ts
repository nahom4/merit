import { err, ok, type Result } from '@merit/shared';
import { z } from 'zod';
import { GmailUnavailable } from '@merit/application';
import type {
  GmailHistory,
  GmailMailboxGateway,
  GmailMessageDetail,
  GmailProfile,
  GmailTokenSet,
  GmailWatch,
} from '@merit/application';

const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional().nullable(),
  expires_in: z.number(),
  scope: z.string(),
  token_type: z.string(),
});

const ProfileResponseSchema = z.object({
  emailAddress: z.string().email(),
  historyId: z.string(),
});

const WatchResponseSchema = z.object({
  historyId: z.string(),
  expiration: z.string(),
});

const HistoryResponseSchema = z.object({
  historyId: z.string(),
  history: z.array(
    z.object({
      id: z.string(),
      messages: z.array(z.object({ id: z.string(), threadId: z.string() })).default([]),
      messagesAdded: z
        .array(z.object({ message: z.object({ id: z.string(), threadId: z.string() }) }))
        .default([]),
    }),
  ),
});

const MessageResponseSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
  snippet: z.string().default(''),
  internalDate: z.string().default('0'),
  payload: z
    .object({
      headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
    })
    .default({ headers: [] }),
});

/**
 * What Google said, not just that it said no.
 *
 * A bare "Gmail returned 404" is unactionable: the profile, history and message calls all
 * answer 404 for different reasons, and Google puts the reason in the body every time.
 */
const failure = async (method: string, url: string, response: Response): Promise<GmailUnavailable> => {
  const body = await response.text().catch(() => '');
  const reason = body.slice(0, 300).replace(/\s+/gu, ' ').trim();
  const path = new URL(url).pathname + new URL(url).search;
  return new GmailUnavailable(
    `${method} ${path} returned ${response.status}${reason === '' ? '' : `: ${reason}`}`,
    { operation: method.toLowerCase() },
  );
};

const postForm = async (url: string, body: URLSearchParams): Promise<Response> =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });

export interface GoogleGmailApiOptions {
  readonly apiBaseUrl: string;
  readonly oauthTokenUrl: string;
  readonly oauthAuthUrl: string;
}

export class GoogleGmailApi implements GmailMailboxGateway {
  constructor(private readonly options: GoogleGmailApiOptions) {}

  static composeAuthUrl(input: {
    readonly authUrl: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly scope: string;
    readonly state: string;
  }): string {
    const params = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: input.scope,
      state: input.state,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });
    return `${input.authUrl}?${params.toString()}`;
  }

  async exchangeAuthorizationCode(input: {
    readonly code: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
  }): Promise<Result<GmailTokenSet, GmailUnavailable>> {
    return this.exchangeToken(
      new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      }),
    );
  }

  async refreshAccessToken(input: {
    readonly refreshToken: string;
    readonly clientId: string;
    readonly clientSecret: string;
  }): Promise<Result<GmailTokenSet, GmailUnavailable>> {
    return this.exchangeToken(
      new URLSearchParams({
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: 'refresh_token',
      }),
    );
  }

  async getProfile(accessToken: string): Promise<Result<GmailProfile, GmailUnavailable>> {
    // No fallback address: every outreach match is keyed off which mailbox this is, so a
    // profile Merit cannot read is an error, not a mailbox called unknown@example.com.
    return this.getJson(`${this.options.apiBaseUrl}/users/me/profile`, accessToken, (raw) => {
      const parsed = ProfileResponseSchema.parse(raw);
      return { emailAddress: parsed.emailAddress, historyId: parsed.historyId };
    });
  }

  async watchMailbox(input: {
    readonly accessToken: string;
    readonly topicName: string;
  }): Promise<Result<GmailWatch, GmailUnavailable>> {
    return this.postJson(
      `${this.options.apiBaseUrl}/users/me/watch`,
      input.accessToken,
      { topicName: input.topicName },
      (raw) => WatchResponseSchema.parse(raw),
    );
  }

  async listHistory(input: {
    readonly accessToken: string;
    readonly startHistoryId: string;
  }): Promise<Result<GmailHistory, GmailUnavailable>> {
    return this.getJson(
      `${this.options.apiBaseUrl}/users/me/history?startHistoryId=${encodeURIComponent(input.startHistoryId)}`,
      input.accessToken,
      (raw) => {
        const parsed = HistoryResponseSchema.parse(raw);
        return {
          historyId: parsed.historyId,
          history: parsed.history.map((entry) => ({
            id: entry.id,
            messages: (entry.messages.length > 0
              ? entry.messages
              : entry.messagesAdded.map((added) => added.message)
            ).map((message) => ({ id: message.id, threadId: message.threadId })),
          })),
        };
      },
    );
  }

  async getMessage(input: {
    readonly accessToken: string;
    readonly messageId: string;
  }): Promise<Result<GmailMessageDetail | null, GmailUnavailable>> {
    // A 404 here means the message was deleted between the history record and this read. That
    // is a fact about the mailbox, not a failure to reach it.
    return this.getJsonOrMissing(
      `${this.options.apiBaseUrl}/users/me/messages/${encodeURIComponent(input.messageId)}?format=full`,
      input.accessToken,
      (raw) => {
        const parsed = MessageResponseSchema.parse(raw);
        return {
          id: parsed.id,
          threadId: parsed.threadId,
          labelIds: parsed.labelIds,
          snippet: parsed.snippet,
          internalDate: parsed.internalDate,
          headers: parsed.payload.headers,
        };
      },
    );
  }

  private async exchangeToken(body: URLSearchParams): Promise<Result<GmailTokenSet, GmailUnavailable>> {
    try {
      const response = await postForm(this.options.oauthTokenUrl, body);
      if (!response.ok) {
        return err(
          new GmailUnavailable(`OAuth token exchange returned ${response.status}`, { operation: 'token' }),
        );
      }
      const parsed = TokenResponseSchema.parse(await response.json());
      return ok({
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token ?? null,
        expiresInSeconds: parsed.expires_in,
        scope: parsed.scope,
        tokenType: parsed.token_type,
      });
    } catch (cause) {
      return err(
        new GmailUnavailable(cause instanceof Error ? cause.message : String(cause), { operation: 'token' }),
      );
    }
  }

  /** As `getJson`, but a 404 is an answer -- the entity is gone -- rather than a failure. */
  private async getJsonOrMissing<T>(
    url: string,
    accessToken: string,
    parse: (raw: unknown) => T,
  ): Promise<Result<T | null, GmailUnavailable>> {
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.status === 404) return ok(null);
      if (!response.ok) return err(await failure('GET', url, response));
      return ok(parse(await response.json()));
    } catch (cause) {
      return err(
        new GmailUnavailable(cause instanceof Error ? cause.message : String(cause), { operation: 'get' }),
      );
    }
  }

  private async getJson<T>(
    url: string,
    accessToken: string,
    parse: (raw: unknown) => T,
  ): Promise<Result<T, GmailUnavailable>> {
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) return err(await failure('GET', url, response));
      return ok(parse(await response.json()));
    } catch (cause) {
      return err(
        new GmailUnavailable(cause instanceof Error ? cause.message : String(cause), { operation: 'get' }),
      );
    }
  }

  private async postJson<T>(
    url: string,
    accessToken: string,
    body: unknown,
    parse: (raw: unknown) => T,
  ): Promise<Result<T, GmailUnavailable>> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) return err(await failure('POST', url, response));
      return ok(parse(await response.json()));
    } catch (cause) {
      return err(
        new GmailUnavailable(cause instanceof Error ? cause.message : String(cause), { operation: 'post' }),
      );
    }
  }
}
