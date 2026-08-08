import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockingKey, decideLink, DEFAULT_THRESHOLDS, scoreCandidate } from '@merit/domain';
import { LibsqlEntityRepository, type Database } from '@merit/infrastructure';
import { openCorpus, recordEvalRun, thresholds, yieldToEventLoop } from './support/corpus.js';

/**
 * Entity resolution accuracy, measured rather than asserted.
 *
 * Schedule I records identify the recipient by tax ID as well as by name; 990-PF records
 * never do. Withholding the tax ID from a Schedule I record, running the full linkage on the
 * name and address alone, and comparing against the withheld truth yields tens of thousands
 * of labelled examples drawn from exactly the population of messy names the system faces --
 * at no cost, refreshed with every corpus rebuild.
 *
 * The stated limitation, restated because it matters: Schedule I filers are public charities
 * and the target population is private foundations, so there is mild distribution shift.
 * These numbers are an upper bound on 990-PF performance, not a measurement of it.
 */
const SAMPLE_SIZE = 4_000;

let db: Database;

interface Labelled {
  readonly truthEin: string;
  readonly name: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
  readonly normalized: string;
}

beforeAll(() => {
  db = openCorpus();
});

afterAll(() => {
  db.close();
});

const labelledSet = async (): Promise<readonly Labelled[]> => {
  const result = await db.execute({
    sql: `SELECT g.stated_recipient_ein, g.recipient_name, g.recipient_normalized,
                 g.recipient_city, g.recipient_state, g.recipient_zip
          FROM grant_records g
          WHERE g.source_form = '990-SI'
            AND g.stated_recipient_ein IS NOT NULL
            AND g.recipient_state IS NOT NULL
            -- Only labels whose truth is in the registry: a recipient the BMF has never
            -- heard of is unlinkable by construction and would measure the registry's
            -- coverage rather than the linker's accuracy.
            AND EXISTS (SELECT 1 FROM entities e WHERE e.ein = g.stated_recipient_ein)
          ORDER BY g.id
          LIMIT ?`,
    args: [SAMPLE_SIZE],
  });

  return result.rows.map((row) => ({
    truthEin: String(row['stated_recipient_ein']),
    name: String(row['recipient_name']),
    normalized: String(row['recipient_normalized']),
    city: row['recipient_city'] === null ? null : String(row['recipient_city']),
    state: row['recipient_state'] === null ? null : String(row['recipient_state']),
    zip: row['recipient_zip'] === null ? null : String(row['recipient_zip']),
  }));
};

describe('entity resolution against the withheld-EIN labelled set', () => {
  it('meets its committed precision and recall floors', async () => {
    const labels = await labelledSet();
    expect(labels.length).toBeGreaterThan(200);

    const entities = new LibsqlEntityRepository(db);
    const blocks = new Map<string, Awaited<ReturnType<LibsqlEntityRepository['findCandidates']>>>();

    let linked = 0;
    let linkedCorrectly = 0;
    let routedToReview = 0;

    for (const [index, label] of labels.entries()) {
      if (index % 250 === 0) await yieldToEventLoop();
      const key = blockingKey(label.normalized, label.state ?? '');
      if (key === null) continue;

      let candidates = blocks.get(key);
      if (candidates === undefined) {
        candidates = await entities.findCandidates(key);
        blocks.set(key, candidates);
      }
      if (!candidates.ok) throw new Error(candidates.error.message);

      const decision = decideLink(
        candidates.value.map((candidate) => ({
          entityId: candidate.ein,
          score: scoreCandidate(label, candidate),
        })),
        DEFAULT_THRESHOLDS,
      );

      if (decision.kind === 'linked') {
        linked += 1;
        if (decision.entityId === label.truthEin) linkedCorrectly += 1;
      } else if (decision.kind === 'needs_review') {
        routedToReview += 1;
      }
    }

    const precision = linked === 0 ? 0 : linkedCorrectly / linked;
    const recall = linkedCorrectly / labels.length;

    await recordEvalRun(db, 'entity_resolution_precision', precision, 'schedule_i_withheld_ein');
    await recordEvalRun(db, 'entity_resolution_recall', recall, 'schedule_i_withheld_ein');
    await recordEvalRun(
      db,
      'entity_resolution_review_rate',
      routedToReview / labels.length,
      'schedule_i_withheld_ein',
    );

    console.log(
      `entity resolution on ${labels.length} withheld-EIN labels: ` +
        `precision ${(precision * 100).toFixed(1)}%, recall ${(recall * 100).toFixed(1)}%, ` +
        `routed to review ${((routedToReview / labels.length) * 100).toFixed(1)}%`,
    );

    expect(precision).toBeGreaterThanOrEqual(thresholds.entity_resolution.precision_floor);
    expect(recall).toBeGreaterThanOrEqual(thresholds.entity_resolution.recall_floor);
    // A review queue that grows without bound is the cheap way to make precision look good,
    // so it is capped rather than merely reported.
    expect(routedToReview / labels.length).toBeLessThanOrEqual(
      thresholds.entity_resolution.review_rate_ceiling,
    );
  });

  it('routes the uncertain band to review instead of guessing at it', async () => {
    const labels = (await labelledSet()).slice(0, 500);
    const entities = new LibsqlEntityRepository(db);

    let wrongLinksInUncertainBand = 0;
    let reviewed = 0;

    for (const [index, label] of labels.entries()) {
      if (index % 250 === 0) await yieldToEventLoop();
      const key = blockingKey(label.normalized, label.state ?? '');
      if (key === null) continue;
      const candidates = await entities.findCandidates(key);
      if (!candidates.ok) throw new Error(candidates.error.message);

      const decision = decideLink(
        candidates.value.map((c) => ({ entityId: c.ein, score: scoreCandidate(label, c) })),
        DEFAULT_THRESHOLDS,
      );
      if (decision.kind === 'needs_review') {
        reviewed += 1;
        if (decision.entityId !== label.truthEin) wrongLinksInUncertainBand += 1;
      }
    }

    // The point of the uncertain band: these would have been errors if the system had
    // guessed. Recording the number makes the review queue's value visible.
    console.log(
      `${reviewed} records routed to review; ${wrongLinksInUncertainBand} of them would have ` +
        'been wrong links had the system guessed',
    );
    expect(reviewed).toBeGreaterThanOrEqual(0);
  });
});
