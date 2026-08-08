import { err, ok, type Result } from '@merit/shared';
import { GmailUnavailable } from '@merit/application';
import type { GmailGateway, GmailMessage, GmailMessageInput } from '@merit/application';

export interface GoogleGmailGatewayOptions {
  readonly baseUrl: string;
  readonly userId: string;
  readonly accessToken?: string;
  readonly timeoutMs: number;
}

const base64Url = (value: string): string =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

export class GoogleGmailGateway implements GmailGateway {
  constructor(private readonly options: GoogleGmailGatewayOptions) {}

  async sendMessage(input: GmailMessageInput): Promise<Result<GmailMessage, GmailUnavailable>> {
    if (this.options.accessToken === undefined) {
      return err(new GmailUnavailable('Gmail is not configured', { operation: 'sendMessage' }));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const mime = [
        `To: ${input.recipients.join(', ')}`,
        `Subject: ${input.subject}`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        input.body,
      ].join('\r\n');

      const response = await fetch(`${this.options.baseUrl}/users/${this.options.userId}/messages/send`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: base64Url(mime) }),
      });

      if (!response.ok) {
        return err(
          new GmailUnavailable(`Gmail returned ${response.status}`, {
            operation: 'sendMessage',
            status: response.status,
          }),
        );
      }

      const raw = (await response.json()) as { id?: unknown };
      return ok({ id: typeof raw.id === 'string' ? raw.id : 'message' });
    } catch (cause) {
      return err(
        new GmailUnavailable(cause instanceof Error ? cause.message : String(cause), {
          operation: 'sendMessage',
        }),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
