import { z } from 'zod';
import { err, ok, type Result } from '@merit/shared';
import type { CachedListingPayload, CachedProspectListing, ProspectListingCache } from '@merit/application';
import { RepositoryUnavailable } from '@merit/application';
import type { Database } from './database.js';

/**
 * The stored listing, parsed on the way back in.
 *
 * A cache is an external byte source like any other: the row was written by an older version of
 * this code as easily as by this one. A payload that no longer matches is a miss, not a crash —
 * the listing is recomputed and overwritten.
 */
const EvidenceSchema = z.object({
  entityEin: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  taxYear: z.number(),
  amountCents: z.number(),
  purpose: z.string().nullable(),
});

const SignalsSchema = z.object({
  turnover: z.number().nullable(),
  newGranteesPerYear: z.number().nullable(),
  newGranteeShare: z.number().nullable(),
  concentration: z.number().nullable(),
  askP50: z.number().nullable(),
  askP90: z.number().nullable(),
  firstTimeAskP50: z.number().nullable(),
  retentionYearsP50: z.number().nullable(),
  stateShares: z.record(z.string(), z.number()),
  distinctGrantees: z.number(),
  totalGrants: z.number(),
  yearsCovered: z.array(z.number()),
});

const ScoreSchema = z.object({
  openness: z.number().nullable(),
  affinity: z.number().nullable(),
  geographyFit: z.number().nullable(),
  sizeFit: z.number().nullable(),
  total: z.number(),
  isCredible: z.boolean(),
  credibilityReason: z.enum([
    'credible',
    'too_few_grantees_in_common',
    'below_materiality_floor',
    'above_size_ceiling',
  ]),
});

const PayloadSchema = z.object({
  prospects: z.array(
    z.object({
      funderEin: z.string(),
      funderName: z.string(),
      funderState: z.string().nullable(),
      score: ScoreSchema,
      signals: SignalsSchema,
      peerGranteeCount: z.number(),
      regionalGranteeCount: z.number(),
      evidence: z.array(EvidenceSchema),
    }),
  ),
  coverage: z.object({
    peersFound: z.number(),
    candidateFundersConsidered: z.number(),
    credibleFunders: z.number(),
    materialityFloorCents: z.number(),
  }),
});

export class LibsqlProspectListingCache implements ProspectListingCache {
  constructor(private readonly db: Database) {}

  async readCached(
    organizationId: string,
  ): Promise<Result<CachedProspectListing | null, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT payload, computed_at FROM prospect_listings WHERE organization_id = ?',
        args: [organizationId],
      });
      const row = result.rows[0];
      if (row === undefined) return ok(null);

      const parsed = PayloadSchema.safeParse(JSON.parse(String(row['payload'])));
      // A payload this version cannot read is a miss. Recomputing costs seconds; serving a
      // half-understood score costs trust.
      if (!parsed.success) return ok(null);

      return ok({ payload: parsed.data, computedAt: String(row['computed_at']) });
    } catch (cause) {
      return err(unavailable('readCached', cause));
    }
  }

  async writeCached(
    organizationId: string,
    payload: CachedListingPayload,
  ): Promise<Result<void, RepositoryUnavailable>> {
    try {
      await this.db.execute({
        sql: `INSERT INTO prospect_listings (organization_id, payload, computed_at)
              VALUES (?, ?, ?)
              ON CONFLICT (organization_id) DO UPDATE SET
                payload = excluded.payload,
                computed_at = excluded.computed_at`,
        args: [organizationId, JSON.stringify(payload), new Date().toISOString()],
      });
      return ok(undefined);
    } catch (cause) {
      return err(unavailable('writeCached', cause));
    }
  }
}

const unavailable = (operation: string, cause: unknown): RepositoryUnavailable =>
  new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
    operation,
    table: 'prospect_listings',
  });
