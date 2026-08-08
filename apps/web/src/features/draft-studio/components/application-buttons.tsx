'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { trackApplicationStage, type TrackApplicationFormState } from '../actions.js';

interface ApplicationButtonsProps {
  readonly organizationId: string;
  readonly opportunityId: string;
  readonly opportunityNumber: string;
  readonly title: string;
  readonly closeDate: string | null;
  readonly studioHref: string;
}

const INITIAL: TrackApplicationFormState = { message: null };

const Submit = ({ stage, label }: { stage: 'started' | 'submitted'; label: string }) => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        stage === 'started'
          ? 'rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-accentStrong disabled:opacity-60'
          : 'rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent disabled:opacity-60'
      }
    >
      {pending ? 'Saving…' : label}
    </button>
  );
};

/**
 * One form per button, each carrying its stage as a hidden field.
 *
 * Two submit buttons in one form would mean the stage rides on the submitter's name and value,
 * and a submitter that does not reach the action degrades silently into the default — which
 * would record "submitted" as "started" and put reminders on a calendar for work already done.
 */
export const ApplicationButtons = (props: ApplicationButtonsProps) => {
  const [startState, startAction] = useFormState(trackApplicationStage, INITIAL);
  const [submitState, submitAction] = useFormState(trackApplicationStage, INITIAL);
  const message = startState.message ?? submitState.message;

  const fields = (stage: 'started' | 'submitted') => (
    <>
      <input type="hidden" name="stage" value={stage} />
      <input type="hidden" name="organizationId" value={props.organizationId} />
      <input type="hidden" name="opportunityId" value={props.opportunityId} />
      <input type="hidden" name="opportunityNumber" value={props.opportunityNumber} />
      <input type="hidden" name="title" value={props.title} />
      <input type="hidden" name="closeDate" value={props.closeDate ?? ''} />
      <input type="hidden" name="studioHref" value={props.studioHref} />
    </>
  );

  return (
    <div className="grid gap-2" data-testid="application-buttons">
      <div className="flex flex-wrap gap-3">
        <form action={startAction}>
          {fields('started')}
          <Submit stage="started" label="Start application" />
        </form>
        <form action={submitAction}>
          {fields('submitted')}
          <Submit stage="submitted" label="Application submitted" />
        </form>
      </div>
      {message === null ? null : (
        <p className="text-xs leading-6 text-muted" data-testid="application-track-result">
          {message}
        </p>
      )}
    </div>
  );
};
