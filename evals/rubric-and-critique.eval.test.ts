import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { Critique, reviewSectionOf, revisionOrder, Rubric } from '@merit/domain';
import { GrantsGovAttachmentGateway } from '@merit/infrastructure';
import { createServer, type Server } from 'node:http';

/**
 * S4's two eval questions: how accurate is rubric extraction, and is the critique calibrated?
 *
 * **What this measures is Merit's half, not the model's.** The document is fetched, the real
 * `pdftotext -layout` runs on it, and the window handed to the extractor is scored against the
 * criteria the announcement really contains. That sets the accuracy *ceiling*: a criterion
 * absent from the characters the model receives cannot be extracted by any model, however good.
 * It also measures what the confidence check does with a known-bad extraction, and whether the
 * revision budget spends its calls where the points are.
 *
 * **What it does not yet measure is the model's own accuracy** — how often Gemini reads this
 * table correctly — or critique calibration against human scores in the strict sense of
 * correlating model scores with reviewer scores. Both need a model credential and a labelled set
 * of scored drafts, and Merit is designed to run with no credential at all, so neither can live
 * in the default suite. The scored-draft set does not exist yet; building it is the honest
 * remaining work behind the roadmap's "critique calibration against human scores", and it is
 * what would move `RUBRIC_CONFIDENCE_THRESHOLD` off the value ADR 0014 argues for rather than
 * measures.
 *
 * The labels below are transcribed from the announcement by hand and are checkable against the
 * committed PDF. They are not a model's opinion of what the answer is.
 */

const PDF = readFileSync(
  resolve('tests/fixtures/grants-gov/attachments/354136-hhs-2026-acf-ocs-eah-0027.pdf'),
);

/**
 * The ground truth for HHS-2026-ACF-OCS-EAH-0027, read off page 44 of the committed PDF.
 * Seven criteria, 115 points, which is the total the document states two lines above them.
 */
const TRUE_CRITERIA = [
  { name: 'Purpose and need', points: 10 },
  { name: 'Response', points: 50 },
  { name: 'Impact', points: 15 },
  { name: 'Resources and capabilities', points: 15 },
  { name: 'Line-item budget and budget narrative', points: 10 },
  { name: 'ACF Priority Alignment', points: 10 },
  { name: 'Bonus Points', points: 5 },
] as const;

const TRUE_TOTAL = 115;

/** The budget the use case actually sends. Measuring any other number measures nothing. */
const RUBRIC_TEXT_BUDGET = 12_000;

const serveThePdf = async (): Promise<{ server: Server; baseUrl: string }> => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': PDF.byteLength });
    response.end(PDF);
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { server, baseUrl: `http://127.0.0.1:${address.port}/att/download` };
};

const extractedText = async (): Promise<string> => {
  const { server, baseUrl } = await serveThePdf();
  try {
    const result = await new GrantsGovAttachmentGateway({ baseUrl, timeoutMs: 30_000 }).fetchText('354136');
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  } finally {
    await new Promise<void>((closed) => server.close(() => closed()));
  }
};

describe('rubric extraction: what Merit is responsible for', () => {
  it('windows onto text that contains every criterion and the stated total', async () => {
    // The accuracy ceiling. Whatever the model does afterwards, it cannot extract a criterion
    // that is not in the characters it was handed.
    const window = reviewSectionOf(await extractedText(), RUBRIC_TEXT_BUDGET);

    const found = TRUE_CRITERIA.filter((criterion) => window.text.includes(criterion.name));
    const recall = found.length / TRUE_CRITERIA.length;

    console.log(
      `rubric window: ${found.length}/${TRUE_CRITERIA.length} criteria present ` +
        `(recall ${(recall * 100).toFixed(0)}%), total stated: ${window.text.includes('115')}, ` +
        `window ${window.text.length} chars of ${(await extractedText()).length}`,
    );

    expect(recall).toBe(1);
    expect(window.headingFound).toBe(true);
    // The stated total is what `Rubric.parse` checks the extracted points against. Losing it
    // caps every extraction from this document at 0.4 confidence, whatever the model returns.
    expect(window.text).toContain(String(TRUE_TOTAL));
  });

  it('costs a small fraction of sending the whole document', async () => {
    const full = await extractedText();
    const window = reviewSectionOf(full, RUBRIC_TEXT_BUDGET);

    const ratio = window.text.length / full.length;
    console.log(`rubric window: ${(ratio * 100).toFixed(1)}% of the document`);

    // Not a tuning target, a floor on the saving. Sending the whole 105,000 characters per
    // extraction is what makes drafting unaffordable on a free tier.
    expect(ratio).toBeLessThan(0.2);
  });
});

describe('rubric extraction: the confidence check, against the real numbers', () => {
  it('trusts an extraction that reproduces the announcement’s own arithmetic', () => {
    const parsed = unwrapOrThrow(
      Rubric.parse({
        confidence: 0.9,
        totalPointsStated: TRUE_TOTAL,
        criteria: TRUE_CRITERIA.map((criterion, index) => ({
          id: String(index + 1),
          name: criterion.name,
          points: criterion.points,
          subCriteria: [],
        })),
      }),
    );

    expect(parsed.totalPoints).toBe(TRUE_TOTAL);
    expect(parsed.confidence).toBe(0.9);
  });

  it('distrusts an extraction that drops the criterion worth most, however sure it sounds', () => {
    // The failure mode the check exists for. Dropping "Response" loses 50 of 115 points and
    // would otherwise produce a draft ignoring the criterion worth 43% of the score.
    const parsed = unwrapOrThrow(
      Rubric.parse({
        confidence: 0.98,
        totalPointsStated: TRUE_TOTAL,
        criteria: TRUE_CRITERIA.filter((criterion) => criterion.name !== 'Response').map(
          (criterion, index) => ({
            id: String(index + 1),
            name: criterion.name,
            points: criterion.points,
            subCriteria: [],
          }),
        ),
      }),
    );

    console.log(`dropped-criterion confidence: ${parsed.confidence} — ${parsed.confidenceReason}`);
    expect(parsed.confidence).toBeLessThan(0.6);
    expect(parsed.confidenceReason).toContain('50 points are unaccounted for');
  });
});

/**
 * Critique calibration, measured on the part that does not need a model: does the revision
 * order actually put effort where the points are?
 *
 * The scores below are hand-assigned against the real 115-point rubric — a plausible first
 * draft, scored the way a reviewer would. What is being checked is not the scores but the
 * decision they drive, which is the thing that spends quota.
 */
describe('critique calibration: revision goes where the points are', () => {
  const RUBRIC = unwrapOrThrow(
    Rubric.parse({
      confidence: 0.9,
      totalPointsStated: TRUE_TOTAL,
      criteria: TRUE_CRITERIA.map((criterion, index) => ({
        id: String(index + 1),
        name: criterion.name,
        points: criterion.points,
        subCriteria: [],
      })),
    }),
  );

  const DRAFT =
    'The organisation serves adults in New Hanover County. ' +
    'It would enrol [the number of new learners] over the grant period. ' +
    'Staff hold degrees in adult education.';

  /** Hand-scored: strong on the small criteria, weak on the 50-point one. The realistic and
   *  most expensive shape of a first draft. */
  const HAND_SCORES: Readonly<Record<string, number>> = {
    'Purpose and need': 8,
    Response: 12,
    Impact: 4,
    'Resources and capabilities': 12,
    'Line-item budget and budget narrative': 8,
    'ACF Priority Alignment': 8,
    'Bonus Points': 4,
  };

  it('revises the 50-point criterion first, not the lowest-scoring one', () => {
    const critique = unwrapOrThrow(
      Critique.parse(
        {
          scores: TRUE_CRITERIA.map((criterion, index) => ({
            criterionId: String(index + 1),
            score: HAND_SCORES[criterion.name] ?? 0,
            citedSentence: 'The organisation serves adults in New Hanover County.',
            comment: 'Hand-scored for calibration.',
          })),
        },
        RUBRIC,
        DRAFT,
      ),
    );

    const order = revisionOrder(critique);
    console.log(
      `revision order: ${order
        .slice(0, 3)
        .map((target) => `${target.criterionName} (+${target.pointsAtStake})`)
        .join(', ')}`,
    );

    // Impact scores 27% and Response scores 24%, so by score alone they are near-identical.
    // By points recoverable they are not: 38 against 11. The first three revision calls are
    // worth 38 + 11 + 6 points, and picking by score would have spent the first on 11.
    expect(order[0]?.criterionName).toBe('Response');
    expect(order[0]?.pointsAtStake).toBe(38);

    const budgeted = order.slice(0, 3).reduce((sum, target) => sum + target.pointsAtStake, 0);
    const everything = order.reduce((sum, target) => sum + target.pointsAtStake, 0);
    console.log(
      `first 3 revisions cover ${((budgeted / everything) * 100).toFixed(0)}% of the points at stake`,
    );

    // The three-call revision budget has to be worth having. If the top three covered a third
    // of what is recoverable, the budget would be the wrong shape.
    expect(budgeted / everything).toBeGreaterThan(0.6);
  });

  it('rejects a fabricated citation at the rate that matters: all of them', () => {
    // Calibration in the sense that counts. A critique's scores are unfalsifiable unless the
    // citation is real, so the measurement is that no fabricated citation survives.
    const fabrications = [
      'We are the largest literacy provider in the state.',
      'The organisation serves adults in Wake County.',
      'Staff hold doctorates in adult education.',
      '',
    ];

    const survived = fabrications.filter(
      (sentence) =>
        Critique.parse(
          {
            scores: TRUE_CRITERIA.map((_criterion, index) => ({
              criterionId: String(index + 1),
              score: 1,
              citedSentence: sentence,
              comment: 'Fabricated.',
            })),
          },
          RUBRIC,
          DRAFT,
        ).ok,
    );

    console.log(
      `fabricated citations rejected: ${fabrications.length - survived.length}/${fabrications.length}`,
    );
    expect(survived).toEqual([]);
  });
});
