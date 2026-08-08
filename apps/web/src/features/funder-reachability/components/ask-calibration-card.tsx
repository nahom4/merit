import type { CalibrationView } from '../view-model.js';

/**
 * The recommended ask.
 *
 * The number never appears alone: the basis it was calculated from sits directly beneath it,
 * and where the recommendation was moved -- raised to the materiality floor, or capped at the
 * organisation's own revenue -- that is said rather than silently applied.
 */
export const AskCalibrationCard = ({ calibration }: { calibration: CalibrationView }) => (
  <section className="panel p-5" data-testid="ask-calibration">
    <h2 className="text-lg font-semibold tracking-tight">What to ask for</h2>

    <p className="mt-2 text-4xl font-semibold tabular-nums" data-testid="recommended-ask">
      {calibration.recommended}
    </p>

    {calibration.range === null ? null : (
      <p className="mt-1 text-sm text-muted">
        Comparable asks ran from <span className="tabular-nums">{calibration.range}</span>.
      </p>
    )}

    <p className="mt-2 max-w-prose text-sm text-muted" data-testid="calibration-basis">
      {calibration.basis}
    </p>

    {calibration.caveat === null ? null : (
      <p className="mt-3 max-w-prose rounded-2xl border border-line/70 bg-white/90 p-3 text-sm">
        {calibration.caveat}
      </p>
    )}
  </section>
);
