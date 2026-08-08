import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrganization, scoreProspects } from '../../../../composition/container.js';
import { toProspectListView } from '../../../../features/prospect-list/view-model.js';
import { ProspectCard } from '../../../../features/prospect-list/components/prospect-card.js';

export const dynamic = 'force-dynamic';

/**
 * Ten funders a page.
 *
 * Cape Fear surfaces 322 credible funders, and 322 cards with their evidence rows expanded is
 * a megabyte of HTML nobody reads past the first screen.
 */
const PAGE_SIZE = 10;

export default async function ProspectsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { page?: string; refresh?: string };
}) {
  const organization = await getOrganization().execute({ organizationId: params.id });
  if (!organization.ok) {
    if (organization.error.code === 'not_found') notFound();
    return <Unavailable />;
  }

  const listing = await scoreProspects().listing(organization.value, {
    refresh: searchParams.refresh === '1',
  });
  if (!listing.ok) return <Unavailable />;

  const view = toProspectListView(listing.value.listing);
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const pageCount = Math.max(1, Math.ceil(view.rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = view.rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageHref = (target: number) => `/organizations/${params.id}/prospects?page=${target}`;

  return (
    <section className="grid gap-8">
      <div className="sticky top-0 z-10 shell-card bg-white/95 p-6 backdrop-blur sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="soft-label">Prospect discovery</span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">
              Prospects for {view.organizationName}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-muted" data-testid="coverage">
              {view.coverage}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-muted">
              Funders whose median grant falls below {view.materialityFloor} are excluded: the application
              would cost more than the grant is worth.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link
              href={`/organizations/${params.id}`}
              className="rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium text-ink"
            >
              Back to profile
            </Link>
            <Link
              href={`/organizations/${params.id}/opportunities`}
              className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-accentStrong"
            >
              Federal opportunities
            </Link>
            <Link
              href={`/organizations/${params.id}/prospects?refresh=1`}
              prefetch={false}
              className="rounded-full border border-line bg-white/80 px-4 py-2 text-center text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
            >
              Score again
            </Link>
            <p className="max-w-[12rem] text-right text-xs leading-6 text-muted" data-testid="computed-at">
              Scored {listing.value.computedAt}. Re-scoring reads every candidate funder&rsquo;s full history
              and takes several seconds.
            </p>
          </div>
        </div>
      </div>

      {view.emptyReason === null ? (
        <div className="grid gap-4">
          <ul className="grid gap-4">
            {rows.map((prospect) => (
              <ProspectCard key={prospect.funderEin} prospect={prospect} />
            ))}
          </ul>

          {pageCount === 1 ? null : (
            <nav
              className="flex flex-wrap items-center justify-between gap-3 panel p-4 text-sm"
              data-testid="pagination"
              aria-label="Prospect pages"
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
    </section>
  );
}

const Unavailable = () => (
  <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
    The database is unavailable, so prospects could not be scored. Nothing was lost.
  </p>
);
