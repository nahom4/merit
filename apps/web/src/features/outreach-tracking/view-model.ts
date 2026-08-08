import type { OutreachRecord } from '@merit/application';
import { gmailComposeHref, gmailThreadHref, nextMessageDraft } from '@merit/application';

export interface FoundationOutreachView {
  readonly statusLabel: string;
  readonly statusTone: 'neutral' | 'success' | 'warning';
  readonly savedAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly composeHref: string;
  readonly contactEmail: string;
  readonly subject: string;
  readonly body: string;
}

export const buildFoundationOutreachView = (input: {
  readonly funderName: string;
  readonly recipientEmail: string | null;
  readonly body: string;
  readonly existing: OutreachRecord | null;
}): FoundationOutreachView => {
  const existing = input.existing;
  const subject = existing?.subject ?? `Funding inquiry: ${input.funderName}`;
  const contactEmail = existing?.contactEmail ?? input.recipientEmail ?? '';
  const body = existing?.body ?? input.body;

  return {
    statusLabel: statusLabelFor(existing?.status ?? 'draft'),
    statusTone: toneFor(existing?.status ?? 'draft'),
    savedAt: existing?.savedAt ?? null,
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    composeHref: gmailComposeHref({
      contactEmail: contactEmail === '' ? null : contactEmail,
      subject,
      body,
    }),
    contactEmail,
    subject,
    body,
  };
};

/** A federal pursuit reuses the outreach statuses, so it needs its own words for them. */
const applicationLabelFor = (status: OutreachRecord['status']): string =>
  status === 'draft' ? 'Application started' : 'Application submitted';

const statusLabelFor = (status: OutreachRecord['status']): string => {
  if (status === 'sent') return 'Saved and sent';
  if (status === 'replied') return 'Replied to in Gmail';
  if (status === 'follow_up_needed') return 'Follow-up needed';
  return 'Draft saved locally';
};

const toneFor = (status: OutreachRecord['status']): FoundationOutreachView['statusTone'] => {
  if (status === 'replied') return 'success';
  if (status === 'follow_up_needed') return 'warning';
  return 'neutral';
};

export interface OutreachRowView {
  readonly key: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly contactLabel: string;
  readonly statusLabel: string;
  readonly statusTone: FoundationOutreachView['statusTone'];
  readonly subject: string;
  readonly savedAt: string;
  readonly lastSyncedAt: string | null;
  /** Null until the pursuit has a Gmail thread — there is no conversation to open yet. */
  readonly threadHref: string | null;
  /** Null while the letter is still a draft: the next message is the first one. */
  readonly nextAction: { readonly label: string; readonly href: string } | null;
  /** A federal application rather than a foundation letter: different words, different links. */
  readonly isFederal: boolean;
}

/**
 * A row on the outreach list, and the one thing to do next on it.
 *
 * The action follows the status rather than offering both: a pursuit that has been answered
 * needs a reply, one that has not needs a nudge, and a draft needs neither until it is sent.
 */
export const buildOutreachRowView = (input: {
  readonly outreach: OutreachRecord;
  readonly organizationName: string;
  readonly now: Date;
}): OutreachRowView => {
  const { outreach } = input;
  const federal = outreach.targetKind === 'federal';
  const replied = outreach.status === 'replied' || outreach.status === 'follow_up_needed';
  const draft = nextMessageDraft({
    kind: replied ? 'reply' : 'follow_up',
    targetName: outreach.targetName,
    subject: outreach.subject,
    organizationName: input.organizationName,
    daysSinceSent: daysBetween(outreach.lastSyncedAt, input.now),
  });

  return {
    key: `${outreach.targetKind}:${outreach.targetId}`,
    targetId: outreach.targetId,
    targetName: outreach.targetName,
    contactLabel: federal ? 'Federal application' : (outreach.contactEmail ?? 'Recipient entered in Gmail'),
    statusLabel: federal ? applicationLabelFor(outreach.status) : statusLabelFor(outreach.status),
    statusTone: toneFor(outreach.status),
    subject: outreach.subject,
    savedAt: outreach.savedAt,
    lastSyncedAt: outreach.lastSyncedAt,
    threadHref: outreach.gmailThreadId === null ? null : gmailThreadHref(outreach.gmailThreadId),
    isFederal: federal,
    // A federal pursuit's next step is the studio, not an email: Merit never submits, and there
    // is nobody to write to until the agency answers.
    nextAction: federal
      ? outreach.status === 'draft'
        ? { label: 'Open the draft studio', href: outreach.body }
        : null
      : outreach.status === 'draft'
        ? null
        : {
            label: replied ? 'Reply' : 'Send a follow-up',
            href: gmailComposeHref({
              contactEmail: outreach.contactEmail,
              subject: draft.subject,
              body: draft.body,
            }),
          },
  };
};

const daysBetween = (from: string | null, now: Date): number | null => {
  if (from === null) return null;
  const sent = Date.parse(from);
  if (Number.isNaN(sent)) return null;
  return Math.max(0, Math.floor((now.getTime() - sent) / (24 * 60 * 60 * 1000)));
};
