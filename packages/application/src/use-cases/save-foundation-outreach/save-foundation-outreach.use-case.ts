import { err, ok, type Result } from '@merit/shared';
import type { OutreachRecord, OutreachRepository } from '../../ports/outreach-repository.port.js';
import { RepositoryUnavailable } from '../../errors.js';

export interface SaveFoundationOutreachInput {
  readonly organizationId: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly contactEmail: string | null;
  readonly subject: string;
  readonly body: string;
}

export interface SaveFoundationOutreachOutput {
  readonly outreach: OutreachRecord;
  readonly composeHref: string;
}

export class SaveFoundationOutreach {
  constructor(private readonly outreaches: OutreachRepository) {}

  async execute(input: unknown): Promise<Result<SaveFoundationOutreachOutput, RepositoryUnavailable>> {
    const parsed = parseInput(input);
    if (parsed === null) {
      return err(
        new RepositoryUnavailable('outreach payload could not be parsed', {
          operation: 'saveFoundationOutreach',
        }),
      );
    }

    const outreach: Omit<OutreachRecord, 'savedAt'> = {
      organizationId: parsed.organizationId,
      targetId: parsed.targetId,
      targetKind: 'foundation',
      targetName: parsed.targetName,
      contactEmail: parsed.contactEmail,
      subject: parsed.subject,
      body: parsed.body,
      status: 'draft',
      gmailMessageId: null,
      gmailThreadId: null,
      lastSyncedAt: null,
      followUpsScheduledAt: null,
    };

    const saved = await this.outreaches.upsertOutreach(outreach);
    if (!saved.ok) return saved;

    return ok({
      outreach: { ...outreach, savedAt: new Date().toISOString() },
      composeHref: gmailComposeHref({
        contactEmail: outreach.contactEmail,
        subject: outreach.subject,
        body: outreach.body,
      }),
    });
  }
}

const parseInput = (input: unknown): SaveFoundationOutreachInput | null => {
  if (typeof input !== 'object' || input === null) return null;

  const record = input as Record<string, unknown>;
  const organizationId = record['organizationId'];
  const targetId = record['targetId'];
  const targetName = record['targetName'];
  const subject = record['subject'];
  const body = record['body'];
  if (
    typeof organizationId !== 'string' ||
    organizationId.trim() === '' ||
    typeof targetId !== 'string' ||
    targetId.trim() === '' ||
    typeof targetName !== 'string' ||
    targetName.trim() === '' ||
    typeof subject !== 'string' ||
    subject.trim() === '' ||
    typeof body !== 'string' ||
    body.trim() === ''
  ) {
    return null;
  }

  const contactEmail = normalizeEmail(record['contactEmail']);
  return { organizationId, targetId, targetName, contactEmail, subject, body };
};

const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.includes('@') ? trimmed : null;
};

export const gmailComposeHref = (input: {
  readonly contactEmail: string | null;
  readonly subject: string;
  readonly body: string;
}): string => {
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    tf: '1',
    su: input.subject,
    body: input.body,
  });
  if (input.contactEmail !== null && input.contactEmail !== '') {
    params.set('to', input.contactEmail);
  }
  return `https://mail.google.com/mail/?${params.toString()}`;
};

/** The conversation itself, in Gmail's web client. */
export const gmailThreadHref = (threadId: string): string =>
  `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;

/**
 * The next message in a pursuit, drafted from what Merit actually knows.
 *
 * No model call: the only facts available here are who was written to, about what, and how long
 * ago. A generated paragraph would add nothing a template cannot, and would add the risk of
 * inventing a claim into an email the user is one click from sending.
 */
export const nextMessageDraft = (input: {
  readonly kind: 'reply' | 'follow_up';
  readonly targetName: string;
  readonly subject: string;
  readonly organizationName: string;
  readonly daysSinceSent: number | null;
}): { readonly subject: string; readonly body: string } => {
  const subject = input.subject.toLowerCase().startsWith('re:') ? input.subject : `Re: ${input.subject}`;

  const opening =
    input.kind === 'reply'
      ? `Thank you for getting back to me.`
      : input.daysSinceSent === null
        ? `I wanted to follow up on the letter of inquiry I sent.`
        : `I wanted to follow up on the letter of inquiry I sent ${input.daysSinceSent} days ago.`;

  const middle =
    input.kind === 'reply'
      ? '[Answer their question here, and say what you are sending with this message.]'
      : '[Add one sentence on anything that has changed since you wrote — a new grant, a milestone, a deadline.]';

  return {
    subject,
    body: [
      `Dear ${input.targetName},`,
      '',
      opening,
      '',
      middle,
      '',
      'I am happy to send anything else that would be useful.',
      '',
      'Best,',
      input.organizationName,
    ].join('\n'),
  };
};
