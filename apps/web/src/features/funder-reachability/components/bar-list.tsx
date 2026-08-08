import type { BarView } from '../view-model.js';

/**
 * A labelled proportion bar. Used for the ask distribution, the geographic spread, and the
 * program mix -- three different questions with the same shape of answer.
 *
 * Every string here was formatted by the view-model. The bar is a `meter` so a screen reader
 * gets the number rather than a decorative div.
 */
export const BarList = ({
  bars,
  caption,
  testId,
}: {
  bars: readonly BarView[];
  caption: string;
  testId: string;
}) => (
  <dl className="grid gap-2" data-testid={testId} aria-label={caption}>
    {bars.map((bar) => (
      <div key={bar.label} className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-3">
        <dt className="truncate text-sm" title={bar.label}>
          {bar.label}
        </dt>
        <div
          className="h-2 w-full rounded bg-line"
          role="meter"
          aria-label={`${bar.label}: ${bar.value}`}
          aria-valuenow={bar.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-2 rounded bg-accent" style={{ width: `${bar.percent}%` }} />
        </div>
        <dd className="text-right text-sm tabular-nums text-muted">{bar.value}</dd>
      </div>
    ))}
  </dl>
);
