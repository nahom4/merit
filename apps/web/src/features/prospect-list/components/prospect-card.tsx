import type { ProspectRowView } from '../view-model.js';
import { ScoreBars } from './score-bars.js';

/** Presentational. Every string was formatted by the view-model. */
export const ProspectCard = ({ prospect }: { prospect: ProspectRowView }) => (
  <li className="panel p-5 sm:p-6" data-testid="prospect-card">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-2xl font-semibold tracking-tight" data-testid="prospect-name">
        {prospect.name}
      </h2>
      {prospect.isRegional ? (
        <span className="rounded-full bg-accentSoft px-3 py-1 text-xs font-medium text-accentStrong">
          Gives in your region
        </span>
      ) : (
        <span className="soft-label">National giving</span>
      )}
    </div>
    <p className="mt-2 text-sm leading-7 text-muted">{prospect.granteeSummary}</p>

    <div className="mt-5">
      <ScoreBars bars={prospect.bars} />
    </div>

    <p className="mt-4">
      <a href={prospect.reportHref} className="text-sm font-medium text-accent">
        Reachability report
      </a>
    </p>

    <dl className="mt-5 flex flex-wrap gap-4 text-sm">
      <div className="rounded-2xl border border-line/70 bg-white/90 px-4 py-3">
        <dt className="text-xs uppercase tracking-[0.2em] text-muted">Median grant</dt>
        <dd className="mt-1 tabular-nums">{prospect.medianGrant}</dd>
      </div>
      <div className="rounded-2xl border border-line/70 bg-white/90 px-4 py-3">
        <dt className="text-xs uppercase tracking-[0.2em] text-muted">Typical first grant</dt>
        <dd className="mt-1 tabular-nums">{prospect.suggestedAsk}</dd>
      </div>
    </dl>

    {prospect.evidence.length === 0 ? null : (
      <details className="mt-5 rounded-2xl border border-line/70 bg-white/80 p-4">
        <summary className="cursor-pointer text-sm font-medium text-accent">
          Show the {prospect.evidence.length} grantee{prospect.evidence.length === 1 ? '' : 's'} behind this
        </summary>
        <table className="mt-4 w-full text-left text-sm">
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
