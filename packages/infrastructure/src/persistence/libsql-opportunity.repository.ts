import { z } from 'zod';
import { err, ok, type Result } from '@merit/shared';
import type {
  EligibilityCheck,
  EligibilityScreening,
  FederalOpportunity,
  FitAssessment,
  OpportunityStatus,
} from '@merit/domain';
import { RepositoryUnavailable } from '@merit/application';
import type {
  BoardRow,
  FitState,
  OpportunityRepository,
  StoredAssessment,
  SweepRun,
} from '@merit/application';
import type { Database } from './database.js';

/**
 * A row is external input like any other: parsed at the edge, never trusted because we wrote
 * it. A column that stops matching this schema is a migration bug, and it surfaces here rather
 * than as `undefined` three layers up.
 */
const StringList = z.string().transform((raw, context) => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed as string[];
    }
  } catch {
    // Falls through to the issue below: an unparseable list is a fault, not an empty list.
  }
  context.addIssue({ code: z.ZodIssueCode.custom, message: 'expected a JSON array of strings' });
  return z.NEVER;
});

/** `{ id, fileName, mimeType }` per attachment. An unparseable list is a fault, not an empty
 *  list -- an announcement whose files we cannot read must say so, not look file-less. */
const AttachmentList = z.string().transform((raw, context) => {
  try {
    const parsed: unknown = JSON.parse(raw);
    const shape = z.array(z.object({ id: z.string(), fileName: z.string(), mimeType: z.string() }));
    const checked = shape.safeParse(parsed);
    if (checked.success) return checked.data;
  } catch {
    // Falls through to the issue below.
  }
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'expected a JSON array of { id, fileName, mimeType }',
  });
  return z.NEVER;
});

const OpportunityRowSchema = z.object({
  id: z.string(),
  number: z.string(),
  title: z.string(),
  agency: z.string(),
  status: z.enum(['posted', 'forecasted', 'closed', 'archived']),
  open_date: z.string().nullable(),
  close_date: z.string().nullable(),
  applicant_type_codes: StringList,
  eligibility_text: z.string().nullable(),
  summary: z.string().nullable(),
  funding_categories: StringList,
  award_ceiling_cents: z.number().nullable(),
  award_floor_cents: z.number().nullable(),
  estimated_funding_cents: z.number().nullable(),
  expected_award_count: z.number().nullable(),
  attachments: AttachmentList,
});

const CheckSchema = z.object({
  rule: z.enum(['applicant_type', 'charity_status', 'geography', 'country']),
  outcome: z.enum(['pass', 'fail', 'cannot_determine']),
  code: z.string(),
  reason: z.string(),
});

const number = (value: unknown): number | null => (value === null ? null : Number(value));

export class LibsqlOpportunityRepository implements OpportunityRepository {
  constructor(private readonly db: Database) {}

  async upsertOpportunities(
    opportunities: readonly FederalOpportunity[],
  ): Promise<Result<{ inserted: number; updated: number }, RepositoryUnavailable>> {
    if (opportunities.length === 0) return ok({ inserted: 0, updated: 0 });

    try {
      const existing = new Set(
        (await this.db.execute('SELECT id FROM opportunities')).rows.map((row) => String(row['id'])),
      );

      const transaction = await this.db.transaction('write');
      try {
        for (const opportunity of opportunities) {
          await transaction.execute({
            sql: `INSERT INTO opportunities (
                    id, number, title, agency, status, open_date, close_date, applicant_type_codes,
                    eligibility_text, summary, funding_categories, award_ceiling_cents,
                    award_floor_cents, estimated_funding_cents, expected_award_count, attachments)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (id) DO UPDATE SET
                    number = excluded.number,
                    title = excluded.title,
                    agency = excluded.agency,
                    status = excluded.status,
                    open_date = excluded.open_date,
                    close_date = excluded.close_date,
                    applicant_type_codes = excluded.applicant_type_codes,
                    eligibility_text = excluded.eligibility_text,
                    summary = excluded.summary,
                    funding_categories = excluded.funding_categories,
                    award_ceiling_cents = excluded.award_ceiling_cents,
                    award_floor_cents = excluded.award_floor_cents,
                    estimated_funding_cents = excluded.estimated_funding_cents,
                    expected_award_count = excluded.expected_award_count,
                    attachments = excluded.attachments`,
            args: [
              opportunity.id,
              opportunity.number,
              opportunity.title,
              opportunity.agency,
              opportunity.status,
              opportunity.openDate,
              opportunity.closeDate,
              JSON.stringify(opportunity.applicantTypeCodes),
              opportunity.eligibilityText,
              opportunity.summary,
              JSON.stringify(opportunity.fundingCategories),
              opportunity.awardCeilingCents,
              opportunity.awardFloorCents,
              opportunity.estimatedFundingCents,
              opportunity.expectedAwardCount,
              JSON.stringify(opportunity.attachments),
            ],
          });

          // Program numbers are rewritten rather than merged: the announcement's current
          // listing is the truth, and a number removed upstream must not linger in a join
          // S5 will trust.
          await transaction.execute({
            sql: 'DELETE FROM opportunity_programs WHERE opportunity_id = ?',
            args: [opportunity.id],
          });
          for (const [index, programNumber] of opportunity.programNumbers.entries()) {
            await transaction.execute({
              sql: `INSERT INTO opportunity_programs (opportunity_id, program_number, program_title)
                    VALUES (?, ?, ?)
                    ON CONFLICT (opportunity_id, program_number) DO UPDATE SET
                      program_title = excluded.program_title`,
              args: [opportunity.id, programNumber, opportunity.programTitles[index] ?? null],
            });
          }
        }
        await transaction.commit();
      } catch (cause) {
        await transaction.rollback();
        throw cause;
      }

      const inserted = opportunities.filter((opportunity) => !existing.has(opportunity.id)).length;
      return ok({ inserted, updated: opportunities.length - inserted });
    } catch (cause) {
      return err(unavailable('upsertOpportunities', 'opportunities', cause));
    }
  }

  async listOpportunities(
    limit: number,
  ): Promise<Result<readonly FederalOpportunity[], RepositoryUnavailable>> {
    try {
      return ok(await this.loadOpportunities(limit));
    } catch (cause) {
      return err(unavailable('listOpportunities', 'opportunities', cause));
    }
  }

  async loadBoard(
    organizationId: string,
    limit: number,
  ): Promise<Result<readonly BoardRow[], RepositoryUnavailable>> {
    try {
      const opportunities = await this.loadOpportunities(limit);

      const assessments = await this.db.execute({
        sql: `SELECT opportunity_id, screening_outcome, screening_checks, fit_score, fit_rationale,
                     fit_matched_program_areas, fit_gaps, fit_state, fit_state_reason, assessed_at
              FROM assessments WHERE organization_id = ?`,
        args: [organizationId],
      });

      const byOpportunity = new Map<string, StoredAssessment>();
      for (const row of assessments.rows) {
        const checks = z.array(CheckSchema).parse(JSON.parse(String(row['screening_checks'])));
        const outcome = z
          .enum(['eligible', 'ineligible', 'indeterminate'])
          .parse(String(row['screening_outcome']));

        const screening: EligibilityScreening = {
          outcome,
          checks: checks as readonly EligibilityCheck[],
          rejections: checks.filter((check) => check.outcome === 'fail') as readonly EligibilityCheck[],
          unresolved: checks.filter(
            (check) => check.outcome === 'cannot_determine',
          ) as readonly EligibilityCheck[],
        };

        const fitScore = number(row['fit_score']);
        const fit: FitAssessment | null =
          fitScore === null
            ? null
            : {
                fitScore,
                rationale: String(row['fit_rationale'] ?? ''),
                matchedProgramAreas: StringList.parse(String(row['fit_matched_program_areas'] ?? '[]')),
                gaps: StringList.parse(String(row['fit_gaps'] ?? '[]')),
              };

        byOpportunity.set(String(row['opportunity_id']), {
          organizationId,
          opportunityId: String(row['opportunity_id']),
          screening,
          fit,
          fitState: z.enum(['scored', 'queued', 'not_applicable']).parse(String(row['fit_state'])),
          fitStateReason: row['fit_state_reason'] === null ? null : String(row['fit_state_reason']),
          assessedAt: String(row['assessed_at']),
        });
      }

      return ok(
        opportunities.map((opportunity) => ({
          opportunity,
          assessment: byOpportunity.get(opportunity.id) ?? null,
        })),
      );
    } catch (cause) {
      return err(unavailable('loadBoard', 'assessments', cause));
    }
  }

  async saveAssessments(
    assessments: readonly StoredAssessment[],
  ): Promise<Result<number, RepositoryUnavailable>> {
    if (assessments.length === 0) return ok(0);

    try {
      const transaction = await this.db.transaction('write');
      try {
        for (const assessment of assessments) {
          await transaction.execute({
            sql: `INSERT INTO assessments (
                    organization_id, opportunity_id, screening_outcome, screening_checks, fit_score,
                    fit_rationale, fit_matched_program_areas, fit_gaps, fit_state, fit_state_reason,
                    assessed_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (organization_id, opportunity_id) DO UPDATE SET
                    screening_outcome = excluded.screening_outcome,
                    screening_checks = excluded.screening_checks,
                    fit_score = excluded.fit_score,
                    fit_rationale = excluded.fit_rationale,
                    fit_matched_program_areas = excluded.fit_matched_program_areas,
                    fit_gaps = excluded.fit_gaps,
                    fit_state = excluded.fit_state,
                    fit_state_reason = excluded.fit_state_reason,
                    assessed_at = excluded.assessed_at`,
            args: [
              assessment.organizationId,
              assessment.opportunityId,
              assessment.screening.outcome,
              JSON.stringify(assessment.screening.checks),
              assessment.fit?.fitScore ?? null,
              assessment.fit?.rationale ?? null,
              assessment.fit === null ? null : JSON.stringify(assessment.fit.matchedProgramAreas),
              assessment.fit === null ? null : JSON.stringify(assessment.fit.gaps),
              assessment.fitState satisfies FitState,
              assessment.fitStateReason,
              assessment.assessedAt,
            ],
          });
        }
        await transaction.commit();
      } catch (cause) {
        await transaction.rollback();
        throw cause;
      }
      return ok(assessments.length);
    } catch (cause) {
      return err(unavailable('saveAssessments', 'assessments', cause));
    }
  }

  async recordSweep(run: SweepRun): Promise<Result<void, RepositoryUnavailable>> {
    try {
      await this.db.execute({
        sql: `INSERT INTO sweep_runs (id, started_at, finished_at, searches_run, hits_seen,
                                      opportunities_inserted, opportunities_updated, parse_faults)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET
                finished_at = excluded.finished_at,
                searches_run = excluded.searches_run,
                hits_seen = excluded.hits_seen,
                opportunities_inserted = excluded.opportunities_inserted,
                opportunities_updated = excluded.opportunities_updated,
                parse_faults = excluded.parse_faults`,
        args: [
          run.id,
          run.startedAt,
          run.finishedAt,
          run.searchesRun,
          run.hitsSeen,
          run.opportunitiesInserted,
          run.opportunitiesUpdated,
          run.parseFaults,
        ],
      });
      return ok(undefined);
    } catch (cause) {
      return err(unavailable('recordSweep', 'sweep_runs', cause));
    }
  }

  async latestSweep(): Promise<Result<SweepRun | null, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute(
        'SELECT * FROM sweep_runs ORDER BY finished_at DESC, id DESC LIMIT 1',
      );
      const row = result.rows[0];
      if (row === undefined) return ok(null);

      return ok({
        id: String(row['id']),
        startedAt: String(row['started_at']),
        finishedAt: String(row['finished_at']),
        searchesRun: Number(row['searches_run']),
        hitsSeen: Number(row['hits_seen']),
        opportunitiesInserted: Number(row['opportunities_inserted']),
        opportunitiesUpdated: Number(row['opportunities_updated']),
        parseFaults: Number(row['parse_faults']),
      });
    } catch (cause) {
      return err(unavailable('latestSweep', 'sweep_runs', cause));
    }
  }

  /** Open work first: an announcement that closes soonest is the one a user must decide on. */
  private async loadOpportunities(limit: number): Promise<readonly FederalOpportunity[]> {
    const result = await this.db.execute({
      sql: `SELECT * FROM opportunities
            ORDER BY (status = 'posted') DESC, close_date IS NULL, close_date ASC, id ASC
            LIMIT ?`,
      args: [limit],
    });

    const programs = await this.db.execute(
      'SELECT opportunity_id, program_number, program_title FROM opportunity_programs ORDER BY program_number',
    );
    const byOpportunity = new Map<string, { numbers: string[]; titles: string[] }>();
    for (const row of programs.rows) {
      const id = String(row['opportunity_id']);
      const entry = byOpportunity.get(id) ?? { numbers: [], titles: [] };
      entry.numbers.push(String(row['program_number']));
      if (row['program_title'] !== null) entry.titles.push(String(row['program_title']));
      byOpportunity.set(id, entry);
    }

    return result.rows.map((row): FederalOpportunity => {
      const parsed = OpportunityRowSchema.parse({
        ...row,
        award_ceiling_cents: number(row['award_ceiling_cents']),
        award_floor_cents: number(row['award_floor_cents']),
        estimated_funding_cents: number(row['estimated_funding_cents']),
        expected_award_count: number(row['expected_award_count']),
      });
      const program = byOpportunity.get(parsed.id) ?? { numbers: [], titles: [] };

      return {
        id: parsed.id,
        number: parsed.number,
        title: parsed.title,
        agency: parsed.agency,
        status: parsed.status satisfies OpportunityStatus,
        openDate: parsed.open_date,
        closeDate: parsed.close_date,
        programNumbers: program.numbers,
        programTitles: program.titles,
        applicantTypeCodes: parsed.applicant_type_codes,
        eligibilityText: parsed.eligibility_text,
        summary: parsed.summary,
        fundingCategories: parsed.funding_categories,
        awardCeilingCents: parsed.award_ceiling_cents,
        awardFloorCents: parsed.award_floor_cents,
        estimatedFundingCents: parsed.estimated_funding_cents,
        expectedAwardCount: parsed.expected_award_count,
        attachments: parsed.attachments,
      };
    });
  }
}

const unavailable = (operation: string, table: string, cause: unknown): RepositoryUnavailable =>
  new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
    operation,
    table,
  });
