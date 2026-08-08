import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrganization, reportFunderReachability } from '../../../../../composition/container.js';
import { toFunderReportView } from '../../../../../features/funder-reachability/view-model.js';
import { YearTable } from '../../../../../features/funder-reachability/components/year-table.js';
import { BarList } from '../../../../../features/funder-reachability/components/bar-list.js';
import { AskCalibrationCard } from '../../../../../features/funder-reachability/components/ask-calibration-card.js';
import { AffinityPaths } from '../../../../../features/funder-reachability/components/affinity-paths.js';
import { FinancialTrend } from '../../../../../features/funder-reachability/components/financial-trend.js';
import { FunderBrief } from '../../../../../features/funder-reachability/components/funder-brief.js';

export const dynamic = 'force-dynamic';

/**
 * S2: the funder reachability report. Should we bother with this funder?
 *
 * A server component that calls one use case and renders what it returns. There is no logic
 * here worth unit-testing, which is the point -- everything that decides anything lives in the
 * domain, the use case, or the view-model.
 */
export default async function FunderReachabilityPage({ params }: { params: { id: string; ein: string } }) {
  const organization = await getOrganization().execute({ organizationId: params.id });
  if (!organization.ok) {
    if (organization.error.code === 'not_found') notFound();
    return <Unavailable />;
  }

  const result = await reportFunderReachability().execute({
    organization: organization.value,
    funderEin: params.ein,
  });
  if (!result.ok) {
    if (result.error.code === 'funder_not_found') notFound();
    return <Unavailable />;
  }

  const view = toFunderReportView(result.value);

  return (
    <article className="grid gap-8 [&>*]:min-w-0">
      <section className="shell-card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href={view.backHref} className="text-sm font-medium text-accent">
              ← Back to prospects for {view.organizationName}
            </Link>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight" data-testid="funder-report-name">
              {view.funderName}
            </h1>
            <p className="mt-2 text-base text-muted">{view.funderLocation}</p>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-muted" data-testid="funder-coverage">
              {view.coverage}
            </p>
          </div>
          <Link
            href={`/organizations/${params.id}/funders/${params.ein}/letter`}
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-accentStrong"
            data-testid="letter-link"
          >
            Draft a letter of inquiry
          </Link>
        </div>
      </section>

      {/* min-w-0 on every grid item: a grid item's automatic minimum is its content's
          min-content width, so one wide table would stretch the column and take every sibling
          panel — and the page — past the viewport on a phone. Each panel scrolls its own
          overflow, so none of them needs that floor. */}
      <section className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">
        <div className="panel min-w-0 p-6">
          <h2 className="text-lg font-semibold tracking-tight">Who it funds, by year</h2>
          {view.yearsEmptyReason === null ? (
            <div className="mt-4">
              <YearTable rows={view.yearRows} />
            </div>
          ) : (
            <p
              className="mt-4 rounded-2xl border border-line/70 bg-white/90 p-4 text-sm leading-7"
              data-testid="years-empty"
            >
              {view.yearsEmptyReason}
            </p>
          )}
        </div>

        <div className="grid min-w-0 gap-6 [&>*]:min-w-0">
          <section className="panel min-w-0 p-6">
            <h2 className="text-lg font-semibold tracking-tight">Grant sizes</h2>
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm" data-testid="ask-distribution">
              {view.askDistribution.rows.map((row) => (
                <div key={row.label}>
                  <dt className="text-muted">{row.label}</dt>
                  <dd className="mt-1 tabular-nums">{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted">{view.askDistribution.sample}</p>
            <div className="mt-4">
              <BarList
                bars={view.askDistribution.buckets}
                caption="Number of grants in each size band"
                testId="ask-buckets"
              />
            </div>
          </section>

          <div className="grid min-w-0 gap-4 [&>*]:min-w-0 sm:grid-cols-2">
            <AskCalibrationCard calibration={view.calibration} />
            <section className="panel p-5">
              <FinancialTrend trend={view.financials} unavailable={view.financialsUnavailable} />
            </section>
          </div>
        </div>

        <section className="panel p-6 xl:col-span-2">
          <h2 className="text-lg font-semibold tracking-tight">Where it gives</h2>
          <div className="mt-4">
            <BarList
              bars={view.geography}
              caption="Share of grants by recipient state"
              testId="geographic-spread"
            />
          </div>
          {view.geographyNote === null ? null : (
            <p className="mt-2 max-w-prose text-xs text-muted">{view.geographyNote}</p>
          )}
        </section>

        <section className="panel p-6 xl:col-span-2">
          <h2 className="text-lg font-semibold tracking-tight">What it funds</h2>
          <div className="mt-4">
            <BarList
              bars={view.programMix}
              caption="Share of grantees by program area"
              testId="program-mix"
            />
          </div>
          {view.programMixNote === null ? null : (
            <p className="mt-2 max-w-prose text-xs text-muted">{view.programMixNote}</p>
          )}
        </section>

        <section className="panel p-6 xl:col-span-2">
          <AffinityPaths affinity={view.affinity} />
        </section>

        <section className="panel p-6 xl:col-span-2">
          <FunderBrief claims={view.claims} limitations={view.limitations} />
        </section>
      </section>
    </article>
  );
}

const Unavailable = () => (
  <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
    The database is unavailable, so this funder could not be reported on. Nothing was lost.
  </p>
);
