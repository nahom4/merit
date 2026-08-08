import { notFound } from 'next/navigation';
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
    <article>
      <a href={view.backHref} className="text-sm text-accent">
        ← Back to prospects for {view.organizationName}
      </a>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight" data-testid="funder-report-name">
        {view.funderName}
      </h1>
      <p className="mt-1 text-sm text-muted">{view.funderLocation}</p>

      <p className="mt-3 max-w-prose text-sm text-muted" data-testid="funder-coverage">
        {view.coverage}
      </p>

      <a
        href={`/organizations/${params.id}/funders/${params.ein}/letter`}
        className="mt-3 inline-block text-sm text-accent"
        data-testid="letter-link"
      >
        Draft a letter of inquiry in this funder’s own language →
      </a>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Who it funds, by year</h2>
        {view.yearsEmptyReason === null ? (
          <div className="mt-3">
            <YearTable rows={view.yearRows} />
          </div>
        ) : (
          <p
            className="mt-3 max-w-prose rounded border border-line bg-gray-50 p-4 text-sm"
            data-testid="years-empty"
          >
            {view.yearsEmptyReason}
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Grant sizes</h2>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm" data-testid="ask-distribution">
          {view.askDistribution.rows.map((row) => (
            <div key={row.label}>
              <dt className="text-muted">{row.label}</dt>
              <dd className="tabular-nums">{row.value}</dd>
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

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Where it gives</h2>
        <div className="mt-3">
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

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">What it funds</h2>
        <div className="mt-3">
          <BarList bars={view.programMix} caption="Share of grantees by program area" testId="program-mix" />
        </div>
        {view.programMixNote === null ? null : (
          <p className="mt-2 max-w-prose text-xs text-muted">{view.programMixNote}</p>
        )}
      </section>

      <AskCalibrationCard calibration={view.calibration} />
      <AffinityPaths affinity={view.affinity} />
      <FinancialTrend trend={view.financials} unavailable={view.financialsUnavailable} />
      <FunderBrief claims={view.claims} limitations={view.limitations} />
    </article>
  );
}

const Unavailable = () => (
  <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
    The database is unavailable, so this funder could not be reported on. Nothing was lost.
  </p>
);
