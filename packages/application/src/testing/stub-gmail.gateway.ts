import { err, ok, type Result } from '@merit/shared';
import { GmailUnavailable } from '../errors.js';
import type { GmailGateway, GmailMessage, GmailMessageInput } from '../ports/gmail-gateway.port.js';

export class StubGmailGateway implements GmailGateway {
  readonly sent: GmailMessageInput[] = [];
  constructor(private readonly failOnSend = false) {}

  async sendMessage(input: GmailMessageInput): Promise<Result<GmailMessage, GmailUnavailable>> {
    this.sent.push(input);
    if (this.failOnSend) {
      return err(new GmailUnavailable('gmail send failed', { operation: 'sendMessage' }));
    }
    return ok({ id: `msg_${this.sent.length}` });
  }
}
