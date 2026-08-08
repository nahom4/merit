import type { ProspectRowView } from '../view-model.js';
import { ScoreBars } from './score-bars.js';

/** Presentational. Every string was formatted by the view-model. */
export const ProspectCard = ({ prospect }: { prospect: ProspectRowView }) => (
  <li className="rounded border border-line p-5" data-testid="prospect-card">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold tracking-tight" data-testid="prospect-name">
        {prospect.name}
      </h2>
      {prospect.isRegional ? (
        <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
          Gives in your region
        </span>
      ) : (
        <span className="text-xs text-muted">National giving</span>
      )}
    </div>
    <p className="mt-1 text-sm text-muted">{prospect.granteeSummary}</p>

    <div className="mt-4">
      <ScoreBars bars={prospect.bars} />
    </div>

    <p className="mt-3">
      <a href={prospect.reportHref} className="text-sm text-accent">
        Reachability report
      </a>
    </p>

    <dl className="mt-4 flex flex-wrap gap-6 text-sm">
      <div>
        <dt className="text-muted">Median grant</dt>
        <dd className="tabular-nums">{prospect.medianGrant}</dd>
      </div>
      <div>
        <dt className="text-muted">Typical first grant</dt>
        <dd className="tabular-nums">{prospect.suggestedAsk}</dd>
      </div>
    </dl>

    {prospect.evidence.length === 0 ? null : (
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-accent">
          Show the {prospect.evidence.length} grantee{prospect.evidence.length === 1 ? '' : 's'} behind this
        </summary>
        <table className="mt-3 w-full text-left text-sm">
          <caption className="sr-only">Grants this funder made to organisations comparable to yours</caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-1 pr-3 font-medium">
                Organisation
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Location
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Year
              </th>
              <th scope="col" className="py-1 font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {prospect.evidence.map((row, index) => (
              <tr key={`${row.name}-${row.year}-${index}`} className="border-b border-line/60">
                <td className="py-1 pr-3">{row.name}</td>
                <td className="py-1 pr-3 text-muted">{row.location}</td>
                <td className="py-1 pr-3 tabular-nums text-muted">{row.year}</td>
                <td className="py-1 tabular-nums">{row.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    )}
  </li>
);
