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
      className="w-full rounded-2xl border border-line bg-white/90 px-4 py-3 text-sm shadow-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-4 focus:ring-accent/10"
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
      className="rounded-full bg-ink px-5 py-3 font-medium text-white shadow-lg shadow-emerald-950/10 transition hover:bg-accentStrong disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save profile'}
    </button>
  );
};

export const OrganizationForm = () => {
  const [state, action] = useFormState(submitOrganizationProfile, INITIAL);

  return (
    <form action={action} className="panel grid gap-5 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Create your profile</h2>
          <p className="mt-1 text-sm text-muted">Just enough detail for Merit to build a peer set.</p>
        </div>
        <span className="soft-label">Foundation for every screen</span>
      </div>
      {state.error === null ? null : (
        <p
          role="alert"
          data-testid="form-error"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
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
      <div className="pt-2">
        <SubmitButton />
      </div>
    </form>
  );
};
