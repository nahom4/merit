import type { CriterionScoreView } from '../view-model.js';

const MOVEMENT_LABEL: Readonly<Record<CriterionScoreView['movement'], string>> = {
  improved: 'improved after revision',
  unchanged: 'unchanged after revision',
  worsened: 'lower after revision',
  not_rescored: 'not re-scored',
};

const MOVEMENT_CLASS: Readonly<Record<CriterionScoreView['movement'], string>> = {
  improved: 'bg-accent/10 text-accent',
  unchanged: 'bg-gray-100 text-gray-700',
  worsened: 'bg-red-50 text-red-800',
  not_rescored: 'bg-gray-100 text-gray-700',
};

/**
 * Per-criterion scores, before and after, each with the sentence it is a judgement about.
 *
 * Presentational. Every string was formatted by the view-model — including the direction of
 * travel, which is reported as what happened rather than as what was hoped for.
 */
export const CriterionScores = ({ criteria }: { criteria: readonly CriterionScoreView[] }) => (
  <ul className="mt-4 grid gap-4">
    {criteria.map((criterion) => (
      <li
        key={criterion.criterionId}
        className="rounded border border-line p-4"
        data-testid="criterion-score"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-medium">
            {criterion.criterionId}. {criterion.criterionName}
          </h3>
          <span className="flex items-baseline gap-2 text-sm tabular-nums">
            <span className="text-muted" data-testid="score-before">
              {criterion.before}
            </span>
            {criterion.after === null ? null : (
              <>
                <span aria-hidden="true" className="text-muted">
                  →
                </span>
                <span
                  className={`rounded px-2 py-0.5 font-medium ${MOVEMENT_CLASS[criterion.movement]}`}
                  data-testid="score-after"
                >
                  {criterion.after}
                </span>
              </>
            )}
          </span>
        </div>

        <div
          className="mt-2 h-2 w-full rounded bg-line"
          role="meter"
          aria-label={`${criterion.criterionName}: ${criterion.after ?? criterion.before}, ${MOVEMENT_LABEL[criterion.movement]}`}
          aria-valuenow={criterion.afterPercent ?? criterion.beforePercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-2 rounded bg-accent"
            style={{ width: `${criterion.afterPercent ?? criterion.beforePercent}%` }}
          />
        </div>

        <p className="mt-3 text-sm">{criterion.comment}</p>

        {/* The rule the critique module exists for: a score cites a sentence from the draft, and
            the sentence was verified to be in it before the score was ever stored. Rendering it
            is what turns the score from a claim into something checkable in a second. */}
        <figure className="mt-3">
          <figcaption className="text-xs uppercase tracking-wide text-muted">
            Scored on this sentence
          </figcaption>
          <blockquote
            className="mt-1 border-l-2 border-line pl-3 text-sm italic text-muted"
            data-testid="cited-sentence"
          >
            {criterion.citedSentence}
          </blockquote>
        </figure>
      </li>
    ))}
  </ul>
);
