import type { Result } from '@merit/shared';
import type { GmailUnavailable } from '../errors.js';

export interface GmailMessageInput {
  readonly recipients: readonly string[];
  readonly subject: string;
  readonly body: string;
}

export interface GmailMessage {
  readonly id: string;
}

export interface GmailGateway {
  sendMessage(input: GmailMessageInput): Promise<Result<GmailMessage, GmailUnavailable>>;
}
