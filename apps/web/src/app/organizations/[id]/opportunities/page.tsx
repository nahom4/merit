import { notFound } from 'next/navigation';
import {
  getOrganization,
  reportRunLog,
  screenFederalOpportunities,
} from '../../../../composition/container.js';
import { toFederalBoardView } from '../../../../features/federal-board/view-model.js';
import { OpportunityRow } from '../../../../features/federal-board/components/opportunity-row.js';
import { RunLog } from '../../../../features/federal-board/components/run-log.js';

export const dynamic = 'force-dynamic';

/**
 * S3: the federal opportunity board.
 *
 * A server component that calls two use cases and renders what they return. Screening happens
 * on every load because it is free -- rules over structured fields, no model, no network -- and
 * scoring happens for a few survivors at a time, with the rest queued for the daily sweep.
 */
export default async function FederalBoardPage({ params }: { params: { id: string } }) {
  const organization = await getOrganization().execute({ organizationId: params.id });
  if (!organization.ok) {
    if (organization.error.code === 'not_found') notFound();
    return <Unavailable />;
  }

  const board = await screenFederalOpportunities().execute({ organization: organization.value });
  if (!board.ok) return <Unavailable />;

  const log = await reportRunLog().execute({ windowHours: 24 });
  if (!log.ok) return <Unavailable />;

  const view = toFederalBoardView(board.value, log.value);

  return (
    <section>
      <a href={view.backHref} className="text-sm text-accent">
        ← Back to {view.organizationName}
      </a>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Federal opportunities</h1>

      <p className="mt-2 max-w-prose text-sm text-muted" data-testid="board-coverage">
        {view.coverage}
      </p>
      <p className="mt-1 max-w-prose text-sm text-muted">{view.scoreCaveat}</p>

      {view.emptyReason === null ? (
        <ul className="mt-8 grid gap-4">
          {view.rows.map((row) => (
            <OpportunityRow key={row.id} row={row} />
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

      <RunLog log={view.runLog} />
    </section>
  );
}

const Unavailable = () => (
  <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
    The database is unavailable, so federal opportunities could not be screened. Nothing was lost.
  </p>
);
