import { notFound } from 'next/navigation';
import Link from 'next/link';
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
/** Ten announcements a page, matching the prospect list. */
const PAGE_SIZE = 10;

export default async function FederalBoardPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { page?: string };
}) {
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
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const pageCount = Math.max(1, Math.ceil(view.rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = view.rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageHref = (target: number) => `/organizations/${params.id}/opportunities?page=${target}`;

  return (
    <section className="grid gap-8">
      <div className="sticky top-0 z-10 shell-card bg-white/95 p-6 backdrop-blur sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href={view.backHref} className="text-sm font-medium text-accent">
              ← Back to {view.organizationName}
            </Link>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">Federal opportunities</h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-muted" data-testid="board-coverage">
              {view.coverage}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-muted">{view.scoreCaveat}</p>
          </div>
          <div className="panel min-w-64 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-muted">What this page does</p>
            <p className="mt-2 text-sm leading-7 text-muted">
              Eligibility is checked before any model call. The survivors are scored for fit and any draft
              link only appears where the cascade says it is safe to offer one.
            </p>
          </div>
        </div>
      </div>

      {view.emptyReason === null ? (
        <div className="grid gap-4">
          <ul className="grid gap-4">
            {rows.map((row) => (
              <OpportunityRow key={row.id} row={row} />
            ))}
          </ul>

          {pageCount === 1 ? null : (
            <nav
              className="panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
              data-testid="pagination"
              aria-label="Opportunity pages"
            >
              <span className="text-muted">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}&ndash;
                {Math.min(currentPage * PAGE_SIZE, view.rows.length)} of {view.rows.length}
              </span>
              <span className="flex items-center gap-3">
                {currentPage === 1 ? null : (
                  <Link href={pageHref(currentPage - 1)} className="font-medium text-accent">
                    ← Previous
                  </Link>
                )}
                <span className="text-muted">
                  Page {currentPage} of {pageCount}
                </span>
                {currentPage === pageCount ? null : (
                  <Link href={pageHref(currentPage + 1)} className="font-medium text-accent">
                    Next →
                  </Link>
                )}
              </span>
            </nav>
          )}
        </div>
      ) : (
        <p className="panel p-5 text-sm leading-7" data-testid="empty-reason">
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
