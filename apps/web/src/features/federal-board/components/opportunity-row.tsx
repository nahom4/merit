import type { OpportunityRowView } from '../view-model.js';

/** Presentational. Every string was formatted by the view-model. */
export const OpportunityRow = ({ row }: { row: OpportunityRowView }) => (
  <li className="rounded border border-line p-5" data-testid="opportunity-row">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{row.title}</h2>
      {row.fit === null ? null : (
        <span
          className={`rounded px-2 py-0.5 text-sm font-medium tabular-nums ${
            row.fit.isHighFit ? 'bg-accent/10 text-accent' : 'bg-gray-100 text-gray-700'
          }`}
          data-testid="fit-score"
        >
          Fit {row.fit.score}
        </span>
      )}
    </div>

    <p className="mt-1 text-sm text-muted">
      {row.number} · {row.agency}
    </p>

    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
      <div>
        <dt className="text-muted">Closes</dt>
        <dd className="tabular-nums">{row.closes}</dd>
      </div>
      <div>
        <dt className="text-muted">Award range</dt>
        <dd className="tabular-nums">{row.awardRange}</dd>
      </div>
      <div>
        <dt className="text-muted">Expected awards</dt>
        <dd className="tabular-nums">{row.expectedAwards}</dd>
      </div>
      <div>
        <dt className="text-muted">Federal program</dt>
        <dd className="tabular-nums" data-testid="program-number">
          {row.programNumber}
        </dd>
      </div>
    </dl>

    {row.fit === null ? null : (
      <div className="mt-4 space-y-3 border-t border-line pt-4">
        <p className="text-sm" data-testid="fit-rationale">
          {row.fit.rationale}
        </p>

        <div data-testid="matched-programs">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Matched program areas</h3>
          {row.fit.matchedEmptyReason === null ? (
            <ul className="mt-1 flex flex-wrap gap-2">
              {row.fit.matchedProgramAreas.map((area) => (
                <li key={area} className="rounded bg-gray-100 px-2 py-0.5 text-sm">
                  {area}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">{row.fit.matchedEmptyReason}</p>
          )}
        </div>

        <div data-testid="fit-gaps">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
            What this organisation cannot currently show
          </h3>
          {row.fit.gapsEmptyReason === null ? (
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {row.fit.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">{row.fit.gapsEmptyReason}</p>
          )}
        </div>
      </div>
    )}

    {row.notScoredReason === null ? null : (
      <p className="mt-4 rounded border border-line bg-gray-50 p-3 text-sm" data-testid="not-scored-reason">
        {row.notScoredReason}
      </p>
    )}

    {row.rejections.length === 0 ? null : (
      <div className="mt-4 rounded border border-line bg-gray-50 p-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
          Screened out before any model was asked
        </h3>
        <ul className="mt-1 space-y-1 text-sm">
          {row.rejections.map((reason) => (
            <li key={reason} data-testid="screening-reason">
              {reason}
            </li>
          ))}
        </ul>
      </div>
    )}

    {row.unresolved.length === 0 ? null : (
      <ul className="mt-3 space-y-1 text-sm text-muted">
        {row.unresolved.map((reason) => (
          <li key={reason} data-testid="unresolved-check">
            Undecided: {reason}
          </li>
        ))}
      </ul>
    )}

    {/* Absent on anything screened out. The view-model decides; this only renders. */}
    {row.draftHref === null ? null : (
      <a href={row.draftHref} className="mt-4 inline-block text-sm text-accent" data-testid="draft-link">
        Draft against this announcement →
      </a>
    )}
  </li>
);
