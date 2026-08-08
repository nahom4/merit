import { z } from 'zod';
import { err, ok, type Result } from '@merit/shared';
import type { Critique, DraftConditioning, DraftSection, Rubric } from '@merit/domain';
import { RepositoryUnavailable } from '@merit/application';
import type { DraftRepository, DraftTargetKind, StoredDraft } from '@merit/application';
import type { Database } from './database.js';

/**
 * A row is external input like any other, and these rows are JSON blobs written by an earlier
 * version of this code — which makes them *more* suspect than a column, not less. A shape that
 * stops matching is a migration bug, and it surfaces here rather than as `undefined` in a
 * React component three layers up.
 */
const RubricSchema = z.object({
  criteria: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      points: z.number().int(),
      subCriteria: z.array(z.string()),
    }),
  ),
  totalPoints: z.number().int(),
  confidence: z.number(),
  confidenceReason: z.string(),
});

const SectionSchema = z.array(
  z.object({
    criterionId: z.string().nullable(),
    heading: z.string(),
    text: z.string(),
    subCriteria: z.array(z.string()),
  }),
);

const CritiqueSchema = z.object({
  perCriterion: z.array(
    z.object({
      criterionId: z.string(),
      criterionName: z.string(),
      score: z.number().int(),
      maxPoints: z.number().int(),
      citedSentence: z.string(),
      comment: z.string(),
    }),
  ),
  totalScore: z.number().int(),
  totalPoints: z.number().int(),
});

const parseJson = <T>(schema: z.ZodType<T>, raw: unknown, column: string): T => {
  if (raw === null || raw === undefined) {
    throw new Error(`drafts.${column} is null where a value was required`);
  }
  return schema.parse(JSON.parse(String(raw)));
};

const parseNullableJson = <T>(schema: z.ZodType<T>, raw: unknown): T | null =>
  raw === null || raw === undefined ? null : schema.parse(JSON.parse(String(raw)));

export class LibsqlDraftRepository implements DraftRepository {
  constructor(private readonly db: Database) {}

  async saveDraft(draft: StoredDraft): Promise<Result<void, RepositoryUnavailable>> {
    try {
      await this.db.execute({
        sql: `INSERT INTO drafts (
                organization_id, target_id, target_kind, rubric, conditioning_kind,
                conditioning_note, conditioning_confidence, sections, critique_before,
                critique_after, revised_criterion_ids, note, drafted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (organization_id, target_id) DO UPDATE SET
                target_kind = excluded.target_kind,
                rubric = excluded.rubric,
                conditioning_kind = excluded.conditioning_kind,
                conditioning_note = excluded.conditioning_note,
                conditioning_confidence = excluded.conditioning_confidence,
                sections = excluded.sections,
                critique_before = excluded.critique_before,
                critique_after = excluded.critique_after,
                revised_criterion_ids = excluded.revised_criterion_ids,
                note = excluded.note,
                drafted_at = excluded.drafted_at`,
        args: [
          draft.organizationId,
          draft.targetId,
          draft.targetKind,
          draft.rubric === null ? null : JSON.stringify(draft.rubric),
          draft.conditioning.kind,
          draft.conditioning.note,
          draft.conditioning.confidence,
          JSON.stringify(draft.sections),
          draft.critiqueBefore === null ? null : JSON.stringify(draft.critiqueBefore),
          draft.critiqueAfter === null ? null : JSON.stringify(draft.critiqueAfter),
          JSON.stringify(draft.revisedCriterionIds),
          draft.note,
          draft.draftedAt,
        ],
      });
      return ok(undefined);
    } catch (cause) {
      return err(unavailable('saveDraft', cause));
    }
  }

  async findDraft(
    organizationId: string,
    targetId: string,
  ): Promise<Result<StoredDraft | null, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM drafts WHERE organization_id = ? AND target_id = ?',
        args: [organizationId, targetId],
      });

      const row = result.rows[0];
      if (row === undefined) return ok(null);

      const conditioning: DraftConditioning = {
        kind: z.enum(['rubric', 'summary']).parse(String(row['conditioning_kind'])),
        note: String(row['conditioning_note']),
        confidence: Number(row['conditioning_confidence']),
      };

      return ok({
        organizationId: String(row['organization_id']),
        targetId: String(row['target_id']),
        targetKind: z
          .enum(['federal', 'foundation'])
          .parse(String(row['target_kind'])) satisfies DraftTargetKind,
        rubric: parseNullableJson(RubricSchema, row['rubric']) as Rubric | null,
        conditioning,
        sections: parseJson(SectionSchema, row['sections'], 'sections') as readonly DraftSection[],
        critiqueBefore: parseNullableJson(CritiqueSchema, row['critique_before']) as Critique | null,
        critiqueAfter: parseNullableJson(CritiqueSchema, row['critique_after']) as Critique | null,
        revisedCriterionIds: parseJson(
          z.array(z.string()),
          row['revised_criterion_ids'],
          'revised_criterion_ids',
        ),
        note: row['note'] === null ? null : String(row['note']),
        draftedAt: String(row['drafted_at']),
      });
    } catch (cause) {
      return err(unavailable('findDraft', cause));
    }
  }
}

const unavailable = (operation: string, cause: unknown): RepositoryUnavailable =>
  new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
    operation,
    table: 'drafts',
  });
