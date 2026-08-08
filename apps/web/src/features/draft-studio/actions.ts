'use server';

import { revalidatePath } from 'next/cache';
import { gmailConnections, trackApplication } from '../../composition/container.js';

export interface TrackApplicationFormState {
  readonly message: string | null;
}

/**
 * Start or finish a federal application.
 *
 * Both buttons run through here because both are the same fact recorded at different stages,
 * and the calendar ride-along uses the mailbox's own OAuth token — the reminders belong on the
 * calendar of the person who connected Gmail, not on a service account nobody reads.
 */
export async function trackApplicationStage(
  _previous: TrackApplicationFormState,
  formData: FormData,
): Promise<TrackApplicationFormState> {
  const stage = formData.get('stage') === 'submitted' ? 'submitted' : 'started';
  const organizationId = String(formData.get('organizationId') ?? '');
  const connection = await gmailConnections().getConnection('primary');
  const accessToken = connection.ok && connection.value !== null ? connection.value.accessToken : undefined;

  const result = await trackApplication(accessToken).execute({
    organizationId,
    opportunityId: String(formData.get('opportunityId') ?? ''),
    opportunityNumber: String(formData.get('opportunityNumber') ?? ''),
    title: String(formData.get('title') ?? ''),
    closeDate: emptyToNull(formData.get('closeDate')),
    studioHref: String(formData.get('studioHref') ?? ''),
    stage,
  });

  if (!result.ok) return { message: 'That could not be recorded. Nothing was lost.' };

  revalidatePath(`/organizations/${organizationId}/outreach`);

  if (stage === 'submitted') {
    return { message: 'Recorded as submitted. It is on the pursuit list.' };
  }
  if (result.value.remindersScheduled === 0) {
    return {
      message:
        accessToken === undefined
          ? 'Started, and on the pursuit list. Connect Gmail to get calendar reminders.'
          : 'Started, and on the pursuit list. No reminders were written.',
    };
  }
  return {
    message:
      `Started. ${result.value.remindersScheduled} reminder(s) on your calendar` +
      `${result.value.deadlineReminderSkipped ? ', though this announcement states no close date' : ''}.`,
  };
}

const emptyToNull = (value: FormDataEntryValue | null): string | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
};
