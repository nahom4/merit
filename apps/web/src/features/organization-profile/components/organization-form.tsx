'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { submitOrganizationProfile, type CreateOrganizationFormState } from '../actions.js';

const INITIAL: CreateOrganizationFormState = { error: null };

const Field = ({
  label,
  name,
  hint,
  ...input
}: { label: string; name: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <div className="grid gap-1">
    <label htmlFor={name} className="text-sm font-medium">
      {label}
    </label>
    <input
      id={name}
      name={name}
      required
      className="w-full rounded border border-line px-3 py-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      {...input}
    />
    {hint === undefined ? null : <p className="text-xs text-muted">{hint}</p>}
  </div>
);

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-accent px-4 py-2 font-medium text-white disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save profile'}
    </button>
  );
};

export const OrganizationForm = () => {
  const [state, action] = useFormState(submitOrganizationProfile, INITIAL);

  return (
    <form action={action} className="grid gap-5">
      {state.error === null ? null : (
        <p
          role="alert"
          data-testid="form-error"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.error}
        </p>
      )}
      <Field label="Organisation name" name="name" defaultValue="" autoComplete="organization" />
      <Field label="EIN" name="ein" hint="Nine digits, hyphen optional." inputMode="numeric" />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="City" name="city" autoComplete="address-level2" />
        <Field label="State" name="state" hint="Two-letter code." maxLength={2} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="NTEE program code" name="nteeCode" hint="For example B60, adult literacy." />
        <Field
          label="Annual revenue (USD)"
          name="annualRevenueDollars"
          hint="Sets the materiality floor for prospects."
          type="number"
          min={0}
          step={1}
        />
      </div>
      <div>
        <SubmitButton />
      </div>
    </form>
  );
};
