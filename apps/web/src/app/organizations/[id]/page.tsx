import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrganization } from '../../../composition/container.js';
import { toOrganizationProfileView } from '../../../features/organization-profile/view-model.js';
import { OrganizationProfileCard } from '../../../features/organization-profile/components/organization-profile-card.js';

export const dynamic = 'force-dynamic';

export default async function OrganizationPage({ params }: { params: { id: string } }) {
  const result = await getOrganization().execute({ organizationId: params.id });

  if (!result.ok) {
    if (result.error.code === 'not_found') notFound();
    // A repository failure is not a 404. Say what happened rather than implying the
    // organisation does not exist.
    return (
      <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
        The database is unavailable, so this profile could not be loaded. Nothing was lost.
      </p>
    );
  }

  return (
    <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-8">
        <OrganizationProfileCard profile={toOrganizationProfileView(result.value)} />
        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href={`/organizations/${params.id}/prospects`}
            className="panel group p-5 transition hover:-translate-y-0.5 hover:border-accent/40"
          >
            <p className="soft-label">Foundation side</p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight group-hover:text-accent">
              See funder prospects
            </h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              Rank credible foundations, open the evidence behind each score, and jump into the reachability
              report for any funder.
            </p>
          </Link>
          <Link
            href={`/organizations/${params.id}/opportunities`}
            className="panel group p-5 transition hover:-translate-y-0.5 hover:border-accent/40"
          >
            <p className="soft-label">Federal side</p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight group-hover:text-accent">
              Scan federal opportunities
            </h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              Screen eligibility first, then open fit-scored opportunities and draft only where the cascade
              says it makes sense.
            </p>
          </Link>
          <Link
            href={`/organizations/${params.id}/outreach`}
            className="panel group p-5 transition hover:-translate-y-0.5 hover:border-accent/40"
          >
            <p className="soft-label">Outreach tracking</p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight group-hover:text-accent">
              See every pursued funder
            </h2>
            <p className="mt-2 text-sm leading-7 text-muted">
              Track draft, sent, and replied statuses in one place, then jump back into the letter when a
              follow-up is needed.
            </p>
          </Link>
        </div>
      </div>

      <aside className="panel p-6">
        <p className="soft-label">Next steps</p>
        <ol className="mt-5 grid gap-3 text-sm leading-7 text-muted">
          <li className="rounded-2xl border border-line/70 bg-white p-4">
            1. Open prospects to see ranked funders.
          </li>
          <li className="rounded-2xl border border-line/70 bg-white p-4">
            2. Inspect a reachability report for one funder.
          </li>
          <li className="rounded-2xl border border-line/70 bg-white p-4">
            3. Move to federal opportunities or a draft.
          </li>
        </ol>
      </aside>
    </section>
  );
}
