'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { syncOutreachNow, type SyncOutreachFormState } from '../actions.js';

const INITIAL: SyncOutreachFormState = { message: null };

const Button = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Reading the mailbox…' : 'Sync now'}
    </button>
  );
};

export const SyncNowButton = () => {
  const [state, action] = useFormState(syncOutreachNow, INITIAL);

  return (
    <form action={action} className="grid justify-items-end gap-2">
      <Button />
      {state.message === null ? null : (
        <p className="max-w-xs text-xs leading-6 text-muted" data-testid="sync-result">
          {state.message}
        </p>
      )}
    </form>
  );
};
