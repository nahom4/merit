import type { ScoreBarView } from '../view-model.js';

/**
 * Four bars, never one number. Collapsing these into a single score is forbidden by the
 * product rules: a development director has to defend the list to a board.
 */
export const ScoreBars = ({ bars }: { bars: readonly ScoreBarView[] }) => (
  <dl className="grid gap-3 sm:grid-cols-2">
    {bars.map((bar) => (
      <div key={bar.label} className="rounded-2xl border border-line/70 bg-white/80 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-sm font-medium" title={bar.explanation}>
            {bar.label}
          </dt>
          <dd className="text-sm tabular-nums text-muted" data-testid={`bar-value-${bar.label}`}>
            {bar.value}
          </dd>
        </div>
        <div
          className="mt-1 h-2 w-full rounded bg-line"
          role="meter"
          aria-label={`${bar.label}: ${bar.value}. ${bar.explanation}`}
          aria-valuenow={bar.percent ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {bar.percent === null ? null : (
            <div className="h-2 rounded bg-accent" style={{ width: `${bar.percent}%` }} />
          )}
        </div>
        <p className="mt-1 text-xs text-muted">{bar.explanation}</p>
      </div>
    ))}
  </dl>
);
