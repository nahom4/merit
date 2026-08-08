import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blockingKey, scoreCandidate } from '@merit/domain';
import type { ScoredCandidate } from '@merit/domain';
import { LibsqlEntityRepository } from '@merit/infrastructure';
import type { CurvePoint, LabelledObservation } from './support/threshold-curve.js';
import {
  measureAt,
  selectOperatingPoint,
  selectReviewBand,
  sweepThresholds,
} from './support/threshold-curve.js';
import { openCorpus, thresholds } from './support/corpus.js';

/**
 * Fits the entity-resolution thresholds against the real curve.
 *
 *   pnpm eval:fit
 *
 * The labelled set is built by withholding the recipient EIN that Schedule I filers state
 * and that 990-PF filers never do: run the linker on the name and address alone, compare
 * against the withheld truth. Tens of thousands of labels drawn from exactly the population
 * of messy names the system faces, at no cost.
 *
 * The sample is split in half. Thresholds are chosen on the fitting half and reported on the
 * held-out half, because a threshold chosen and scored on the same rows measures how well it
 * memorised them. The held-out numbers are the ones that belong in evals/thresholds.json.
 *
 * Distribution shift, restated: Schedule I filers are public charities and the target
 * population is private foundations. These numbers bound 990-PF performance from above.
 */
const SAMPLE_SIZE = Number(process.env['MERIT_FIT_SAMPLE_SIZE'] ?? 20_000);
const TARGET_PRECISION = Number(process.env['MERIT_FIT_TARGET_PRECISION'] ?? 0.98);
/** Share of records allowed to sit in the review band rather than be discarded unseen. */
const REVIEW_BUDGET = Number(process.env['MERIT_FIT_REVIEW_BUDGET'] ?? 0.1);
const CURVE_PATH = fileURLToPath(new URL('./link-threshold-curve.json', import.meta.url));

const range = (from: number, to: number, step: number): readonly number[] => {
  const values: number[] = [];
  for (let value = from; value <= to + 1e-9; value += step) values.push(Number(value.toFixed(4)));
  return values;
};

const GRID = {
  link: range(0.7, 0.99, 0.01),
  reject: range(0.5, 0.9, 0.05),
  ambiguityMargin: [0, 0.005, 0.01, 0.02, 0.04, 0.08],
} as const;

interface Label {
  readonly truthEin: string;
  readonly name: string;
  readonly normalized: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
}

const main = async (): Promise<void> => {
  const db = openCorpus();
  const entities = new LibsqlEntityRepository(db);

  // Only labels whose truth is in the registry: a recipient the BMF has never heard of is
  // unlinkable by construction and would measure the registry's coverage, not the linker's.
  const rows = await db.execute({
    sql: `SELECT stated_recipient_ein, recipient_name, recipient_normalized,
                 recipient_city, recipient_state, recipient_zip
          FROM grant_records g
          WHERE g.source_form = '990-SI'
            AND g.stated_recipient_ein IS NOT NULL
            AND g.recipient_state IS NOT NULL
            AND EXISTS (SELECT 1 FROM entities e WHERE e.ein = g.stated_recipient_ein)
          ORDER BY g.id
          LIMIT ?`,
    args: [SAMPLE_SIZE],
  });

  const labels: Label[] = rows.rows.map((row) => ({
    truthEin: String(row['stated_recipient_ein']),
    name: String(row['recipient_name']),
    normalized: String(row['recipient_normalized']),
    city: row['recipient_city'] === null ? null : String(row['recipient_city']),
    state: row['recipient_state'] === null ? null : String(row['recipient_state']),
    zip: row['recipient_zip'] === null ? null : String(row['recipient_zip']),
  }));

  console.log(`scoring ${labels.length} labels against the registry...`);

  const blocks = new Map<string, Awaited<ReturnType<LibsqlEntityRepository['findCandidates']>>>();
  const observations: LabelledObservation[] = [];

  for (const [index, label] of labels.entries()) {
    if (index > 0 && index % 2_000 === 0) console.log(`  ${index}/${labels.length}`);

    const key = blockingKey(label.normalized, label.state ?? '');
    if (key === null) continue;

    let candidates = blocks.get(key);
    if (candidates === undefined) {
      candidates = await entities.findCandidates(key);
      blocks.set(key, candidates);
    }
    if (!candidates.ok) throw new Error(candidates.error.message);

    // Only the top two survive: decideLink cannot see past them, so keeping more would be
    // memory spent on rows no threshold can reach.
    const scored: ScoredCandidate[] = candidates.value
      .map((candidate) => ({ entityId: candidate.ein, score: scoreCandidate(label, candidate) }))
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 2);

    observations.push({ truthEntityId: label.truthEin, topCandidates: scored });
  }

  db.close();

  const split = Math.floor(observations.length / 2);
  const fitting = observations.slice(0, split);
  const heldOut = observations.slice(split);
  console.log(`\n${fitting.length} fitting observations, ${heldOut.length} held out\n`);

  const curve = sweepThresholds(fitting, GRID);

  // Two steps, because the two decisions answer different questions. `link` and the
  // ambiguity margin trade recall against precision; `reject` decides only how much is kept
  // for a human, and cannot move either number.
  const operatingPoint = selectOperatingPoint(curve, TARGET_PRECISION);
  if (operatingPoint === null) {
    console.error(
      `No operating point on ${curve.length} grid points reaches ${TARGET_PRECISION} precision.\n` +
        'The scorer, not the threshold, is what needs work. Nothing was written.',
    );
    process.exitCode = 1;
    return;
  }

  const chosen = selectReviewBand(curve, operatingPoint.thresholds, REVIEW_BUDGET);
  if (chosen === null) {
    console.error(
      `Every review band at the chosen operating point exceeds the ${REVIEW_BUDGET} budget.\n` +
        'Raise the budget deliberately or improve the scorer. Nothing was written.',
    );
    process.exitCode = 1;
    return;
  }

  const verified = measureAt(heldOut, chosen.thresholds);

  const report = (label: string, point: CurvePoint): void =>
    console.log(
      `${label.padEnd(10)} link ${point.thresholds.link.toFixed(2)} reject ${point.thresholds.reject.toFixed(2)} ` +
        `margin ${point.thresholds.ambiguityMargin.toFixed(3)} -> ` +
        `precision ${(point.precision * 100).toFixed(2)}% recall ${(point.recall * 100).toFixed(2)}% ` +
        `review ${(point.reviewRate * 100).toFixed(1)}%`,
    );

  console.log(
    `swept ${curve.length} grid points at a ${TARGET_PRECISION} precision target ` +
      `and a ${REVIEW_BUDGET} review budget\n`,
  );
  report('fitted', chosen);
  report('held out', verified);

  // The neighbourhood, so a reader can see whether the choice sits on a cliff or a plateau.
  console.log('\nrecall by link threshold at the chosen reject and margin:');
  for (const point of curve) {
    if (
      point.thresholds.reject !== chosen.thresholds.reject ||
      point.thresholds.ambiguityMargin !== chosen.thresholds.ambiguityMargin
    ) {
      continue;
    }
    report(point.thresholds.link === chosen.thresholds.link ? '  <-- ' : '', point);
  }

  writeFileSync(
    CURVE_PATH,
    `${JSON.stringify(
      {
        $comment: [
          'Generated by `pnpm eval:fit`. The fitted operating point for entity resolution and',
          'the curve it was chosen from. Committed so a threshold change can be reviewed',
          'against the evidence that motivated it rather than taken on trust.',
        ],
        generatedAt: new Date().toISOString(),
        sample: {
          labels: observations.length,
          fitting: fitting.length,
          heldOut: heldOut.length,
          source: 'schedule_i_withheld_ein',
        },
        targetPrecision: TARGET_PRECISION,
        reviewBudget: REVIEW_BUDGET,
        chosen: { thresholds: chosen.thresholds, fitting: chosen, heldOut: verified },
        curve,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\ncurve written to ${CURVE_PATH}`);
  console.log(
    'Next: put the chosen thresholds in DEFAULT_THRESHOLDS (packages/domain) and the held-out\n' +
      `precision and recall in evals/thresholds.json (currently ` +
      `${thresholds.entity_resolution.precision_floor} / ${thresholds.entity_resolution.recall_floor}), ` +
      'then re-run `pnpm worker resolve` so the corpus reflects the new thresholds.',
  );
};

await main();
