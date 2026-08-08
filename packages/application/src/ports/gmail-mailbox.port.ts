import type { Result } from '@merit/shared';
import type { GmailUnavailable } from '../errors.js';

export interface GmailTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresInSeconds: number;
  readonly scope: string;
  readonly tokenType: string;
}

export interface GmailProfile {
  readonly emailAddress: string;
  /** Where the mailbox is now — the starting point for a sync nobody pushed. */
  readonly historyId: string;
}

export interface GmailWatch {
  readonly historyId: string;
  readonly expiration: string;
}

export interface GmailMessageHeader {
  readonly name: string;
  readonly value: string;
}

export interface GmailMessageDetail {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds: readonly string[];
  readonly snippet: string;
  readonly internalDate: string;
  readonly headers: readonly GmailMessageHeader[];
}

export interface GmailHistoryMessage {
  readonly id: string;
  readonly threadId: string;
}

export interface GmailHistoryRecord {
  readonly id: string;
  readonly messages: readonly GmailHistoryMessage[];
}

export interface GmailHistory {
  readonly historyId: string;
  readonly history: readonly GmailHistoryRecord[];
}

export interface GmailMailboxGateway {
  exchangeAuthorizationCode(input: {
    readonly code: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
  }): Promise<Result<GmailTokenSet, GmailUnavailable>>;
  refreshAccessToken(input: {
    readonly refreshToken: string;
    readonly clientId: string;
    readonly clientSecret: string;
  }): Promise<Result<GmailTokenSet, GmailUnavailable>>;
  getProfile(accessToken: string): Promise<Result<GmailProfile, GmailUnavailable>>;
  watchMailbox(input: {
    readonly accessToken: string;
    readonly topicName: string;
  }): Promise<Result<GmailWatch, GmailUnavailable>>;
  listHistory(input: {
    readonly accessToken: string;
    readonly startHistoryId: string;
  }): Promise<Result<GmailHistory, GmailUnavailable>>;
  /** Null when Gmail no longer has the message: it was deleted after the history was written. */
  getMessage(input: {
    readonly accessToken: string;
    readonly messageId: string;
  }): Promise<Result<GmailMessageDetail | null, GmailUnavailable>>;
}
