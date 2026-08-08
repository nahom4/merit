import Link from 'next/link';
import { OrganizationForm } from '../../../features/organization-profile/components/organization-form.js';

export default function NewOrganizationPage() {
  return (
    <section className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.6fr)] lg:items-start">
      <div className="space-y-6">
        <div className="shell-card p-6 sm:p-8">
          <span className="soft-label">Step 1 of 4</span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">
            Start with the organisation you want to fund
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-muted">
            Program code, revenue, and location are what Merit uses to build a peer set. Everything on the
            prospect list, reachability report, federal board, and draft studio is derived from these facts
            and the filings behind them.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link
              href="/"
              className="rounded-full border border-line bg-white/80 px-4 py-2 font-medium text-ink"
            >
              View the product overview
            </Link>
          </div>
        </div>
        <OrganizationForm />
      </div>

      <aside className="panel p-6">
        <p className="soft-label">Why this matters</p>
        <ul className="mt-5 grid gap-4 text-sm leading-7 text-muted">
          <li className="rounded-2xl border border-line/70 bg-white p-4">
            Merit ranks funders against your organisation’s size, geography, and program area.
          </li>
          <li className="rounded-2xl border border-line/70 bg-white p-4">
            The same profile powers the foundation list, federal board, and draft studio.
          </li>
          <li className="rounded-2xl border border-line/70 bg-white p-4">
            Once saved, you can move straight into prospects or federal opportunities.
          </li>
        </ul>
      </aside>
    </section>
  );
}
