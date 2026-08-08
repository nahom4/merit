import { OrganizationForm } from '../../../features/organization-profile/components/organization-form.js';

export default function NewOrganizationPage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Your organisation</h1>
      <p className="mt-2 max-w-prose text-muted">
        Program code, revenue, and location are what Merit builds a peer set from. Everything on the prospect
        list is derived from these four facts and the filings behind them.
      </p>
      <div className="mt-8">
        <OrganizationForm />
      </div>
    </section>
  );
}
