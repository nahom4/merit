'use server';

import { revalidatePath } from 'next/cache';
import { gmailConnections, saveFoundationOutreach, syncGmailOutreach } from '../../composition/container.js';

export interface FoundationOutreachFormState {
  readonly error: string | null;
  readonly statusLabel: string;
  readonly composeHref: string | null;
  readonly savedAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly contactEmail: string;
}

export async function submitFoundationOutreach(
  _previous: FoundationOutreachFormState,
  formData: FormData,
): Promise<FoundationOutreachFormState> {
  const result = await saveFoundationOutreach().execute({
    organizationId: String(formData.get('organizationId') ?? ''),
    targetId: String(formData.get('targetId') ?? ''),
    targetName: String(formData.get('targetName') ?? ''),
    contactEmail: normalizeEmail(formData.get('contactEmail')),
    subject: String(formData.get('subject') ?? ''),
    body: String(formData.get('body') ?? ''),
  });

  if (!result.ok) {
    return {
      error: 'The outreach draft could not be saved. Nothing was lost.',
      statusLabel: 'Draft not saved',
      composeHref: null,
      savedAt: null,
      lastSyncedAt: null,
      contactEmail: '',
    };
  }

  return {
    error: null,
    statusLabel: 'Draft saved locally',
    composeHref: result.value.composeHref,
    savedAt: result.value.outreach.savedAt,
    lastSyncedAt: result.value.outreach.lastSyncedAt,
    contactEmail: result.value.outreach.contactEmail ?? '',
  };
}

const normalizeEmail = (value: FormDataEntryValue | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export interface SyncOutreachFormState {
  readonly message: string | null;
}

/**
 * Pull the mailbox now, for the case Pub/Sub cannot serve: a laptop with no public URL.
 * The same use case the webhook calls, started from the mailbox's own history id.
 */
export async function syncOutreachNow(
  _previous: SyncOutreachFormState,
  _formData: FormData,
): Promise<SyncOutreachFormState> {
  // The calendar rides the connected mailbox's token, so it is read before the sync starts.
  const connection = await gmailConnections().getConnection('primary');
  const service = syncGmailOutreach(
    connection.ok && connection.value !== null ? connection.value.accessToken : undefined,
  );
  if (service === null) {
    return { message: 'Gmail is not configured, so there is nothing to sync.' };
  }

  const result = await service.syncNow();
  if (!result.ok) return { message: `Gmail could not be read: ${result.error.message}` };
  if (!result.value.connectionFound) return { message: 'No Gmail mailbox is connected yet.' };

  revalidatePath('/organizations/[id]/outreach', 'page');
  return {
    message:
      result.value.messagesSeen === 0
        ? 'Already up to date — nothing has changed in the mailbox since the last sync.'
        : `Read ${result.value.messagesSeen} changed message(s), updated ${result.value.outreachesUpdated} outreach record(s)` +
          `${result.value.messagesGone === 0 ? '' : `, skipped ${result.value.messagesGone} already deleted`}` +
          `${result.value.followUpsScheduled === 0 ? '' : `, put ${result.value.followUpsScheduled} follow-up reminders on your calendar`}.`,
  };
}
