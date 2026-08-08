import { notFound } from 'next/navigation';
import { getOrganization, scoreProspects } from '../../../../composition/container.js';
import { toProspectListView } from '../../../../features/prospect-list/view-model.js';
import { ProspectCard } from '../../../../features/prospect-list/components/prospect-card.js';

export const dynamic = 'force-dynamic';

export default async function ProspectsPage({ params }: { params: { id: string } }) {
  const organization = await getOrganization().execute({ organizationId: params.id });
  if (!organization.ok) {
    if (organization.error.code === 'not_found') notFound();
    return <Unavailable />;
  }

  const listing = await scoreProspects().execute(organization.value);
  if (!listing.ok) return <Unavailable />;

  const view = toProspectListView(listing.value);

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Prospects for {view.organizationName}</h1>

      <p className="mt-2 max-w-prose text-sm text-muted" data-testid="coverage">
        {view.coverage}
      </p>
      <p className="mt-1 max-w-prose text-sm text-muted">
        Funders whose median grant falls below {view.materialityFloor} are excluded: the application would
        cost more than the grant is worth.
      </p>

      {view.emptyReason === null ? (
        <ul className="mt-8 grid gap-4">
          {view.rows.map((prospect) => (
            <ProspectCard key={prospect.funderEin} prospect={prospect} />
          ))}
        </ul>
      ) : (
        <p
          className="mt-8 max-w-prose rounded border border-line bg-gray-50 p-4 text-sm"
          data-testid="empty-reason"
        >
          {view.emptyReason}
        </p>
      )}
    </section>
  );
}

const Unavailable = () => (
  <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
    The database is unavailable, so prospects could not be scored. Nothing was lost.
  </p>
);
