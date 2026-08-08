'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { FoundationOutreachView } from '../view-model.js';
import { submitFoundationOutreach, type FoundationOutreachFormState } from '../actions.js';

interface OutreachCardProps {
  readonly organizationId: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly initialView: FoundationOutreachView;
}

const INITIAL = (view: FoundationOutreachView): FoundationOutreachFormState => ({
  error: null,
  statusLabel: view.statusLabel,
  composeHref: view.composeHref,
  savedAt: view.savedAt,
  lastSyncedAt: view.lastSyncedAt,
  contactEmail: view.contactEmail,
});

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-accentStrong disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save outreach'}
    </button>
  );
};

export const OutreachCard = ({ organizationId, targetId, targetName, initialView }: OutreachCardProps) => {
  const [state, action] = useFormState(submitFoundationOutreach, INITIAL(initialView));

  return (
    <form className="panel grid gap-5 p-6" action={action}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="soft-label">Outreach tracking</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">{targetName}</h2>
          <p className="mt-2 max-w-prose text-sm leading-7 text-muted">
            Save the recipient you found, open the draft in Gmail, and keep the thread anchored here for later
            reply tracking.
          </p>
        </div>
        <span className="soft-label">{state.statusLabel}</span>
      </div>

      {state.error === null ? null : (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {state.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">
          Recipient email
          <input
            name="contactEmail"
            defaultValue={state.contactEmail}
            className="w-full rounded-2xl border border-line bg-white/90 px-4 py-3 text-sm shadow-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-4 focus:ring-accent/10"
            placeholder="Optional: leave blank and enter it in Gmail"
            autoComplete="email"
          />
        </label>
        <div className="grid gap-1 text-sm font-medium">
          <span>Tracking status</span>
          <div className="rounded-2xl border border-line/70 bg-white/90 px-4 py-3 text-sm text-muted">
            {state.statusLabel}
            {state.savedAt === null ? null : <div className="mt-1 text-xs">Saved {state.savedAt}</div>}
            {state.lastSyncedAt === null ? null : (
              <div className="mt-1 text-xs">Last synced {state.lastSyncedAt}</div>
            )}
          </div>
        </div>
      </div>

      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="targetName" value={targetName} />
      <input type="hidden" name="subject" value={initialView.subject} />
      <input type="hidden" name="body" value={initialView.body} />

      <div className="grid gap-3">
        <div>
          <p className="text-sm font-medium">Subject</p>
          <p className="mt-1 rounded-2xl border border-line/70 bg-white/90 px-4 py-3 text-sm">
            {initialView.subject}
          </p>
        </div>
        <div>
          <p className="text-sm font-medium">Body</p>
          <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl border border-line/70 bg-white/90 px-4 py-3 text-sm leading-7">
            {initialView.body}
          </pre>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        {state.composeHref === null ? null : (
          <a
            href={state.composeHref}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
          >
            Open in Gmail
          </a>
        )}
      </div>
    </form>
  );
};
