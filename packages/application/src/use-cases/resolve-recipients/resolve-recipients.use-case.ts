import { ok, type Logger, type Result } from '@merit/shared';
import {
  blockingKey,
  decideLink,
  DEFAULT_THRESHOLDS,
  scoreCandidate,
  type LinkDecision,
  type LinkThresholds,
} from '@merit/domain';
import type { EntityRepository, UnresolvedGrant } from '../../ports/entity-repository.port.js';
import type { RepositoryUnavailable } from '../../errors.js';

export interface ResolveRecipientsResult {
  readonly considered: number;
  readonly linked: number;
  readonly needsReview: number;
  readonly rejected: number;
  /** Links taken straight from a stated EIN, with no scoring involved. */
  readonly fromStatedEin: number;
}

export interface ResolveRecipientsOptions {
  readonly thresholds?: LinkThresholds;
  readonly batchSize?: number;
  /**
   * Ignore the EIN a Schedule I filing states and resolve on name and address alone. This is
   * how the labelled evaluation set is built: withhold the truth, predict, compare.
   */
  readonly ignoreStatedEin?: boolean;
  /** Bound on the candidate-block cache. Trades memory for repeated registry queries. */
  readonly maxCachedBlocks?: number;
  /**
   * Discard the machine-made decisions and re-decide the whole corpus. Required after the
   * thresholds are refitted: without it a run is a no-op, because every record already has
   * a decision and only undecided records are considered. Human review is preserved.
   */
  readonly reset?: boolean;
}

/**
 * Links free-text recipient strings to real registered organisations.
 *
 * This is the load-bearing component of the system: every prospect score, peer set, and
 * funder signal depends on it being right. Which is why it never guesses -- an uncertain
 * match is routed to a human rather than resolved by coin flip.
 */
export class ResolveRecipients {
  constructor(
    private readonly entities: EntityRepository,
    private readonly logger: Logger,
  ) {}

  async execute(
    options: ResolveRecipientsOptions = {},
  ): Promise<Result<ResolveRecipientsResult, RepositoryUnavailable>> {
    const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
    const batchSize = options.batchSize ?? 5_000;

    const tally = { considered: 0, linked: 0, needsReview: 0, rejected: 0, fromStatedEin: 0 };

    if (options.reset === true) {
      const cleared = await this.entities.clearMachineLinks();
      if (!cleared.ok) return cleared;
      this.logger.info('machine decisions cleared for re-resolution', { cleared: cleared.value });
    }

    // One candidate list per block, held across batches. A block -- one state plus one
    // phonetic key -- is shared by thousands of grants spread through the corpus, so a cache
    // cleared per batch would re-query the same rows hundreds of thousands of times over a
    // 1.4M-record run. Bounded so a long run cannot grow without limit.
    const blockCache = new Map<string, Awaited<ReturnType<EntityRepository['findCandidates']>>>();
    const maxCachedBlocks = options.maxCachedBlocks ?? 50_000;

    for await (const batch of this.entities.unresolvedGrants(batchSize)) {
      const links: { grantRecordId: string; decision: LinkDecision }[] = [];
      if (blockCache.size > maxCachedBlocks) blockCache.clear();

      for (const grant of batch) {
        tally.considered += 1;

        const decision = await this.decide(grant, thresholds, blockCache, options.ignoreStatedEin === true);
        if (!decision.ok) return decision;

        links.push({ grantRecordId: grant.grantRecordId, decision: decision.value.decision });
        if (decision.value.fromStatedEin) tally.fromStatedEin += 1;
        if (decision.value.decision.kind === 'linked') tally.linked += 1;
        else if (decision.value.decision.kind === 'needs_review') tally.needsReview += 1;
        else tally.rejected += 1;
      }

      const saved = await this.entities.saveLinks(links);
      if (!saved.ok) return saved;
      this.logger.info('resolution batch written', {
        considered: tally.considered,
        linked: tally.linked,
        needsReview: tally.needsReview,
        cachedBlocks: blockCache.size,
      });
    }

    return ok(tally);
  }

  private async decide(
    grant: UnresolvedGrant,
    thresholds: LinkThresholds,
    blockCache: Map<string, Awaited<ReturnType<EntityRepository['findCandidates']>>>,
    ignoreStatedEin: boolean,
  ): Promise<Result<{ decision: LinkDecision; fromStatedEin: boolean }, RepositoryUnavailable>> {
    // A Schedule I filing that states the recipient's EIN has told us the answer. Scoring a
    // name against it would be strictly worse than believing the filer.
    if (!ignoreStatedEin && grant.statedRecipientEin !== null) {
      return ok({
        decision: {
          kind: 'linked',
          entityId: grant.statedRecipientEin,
          score: { tokenSet: 1, stringDistance: 1, addressAgreement: 1, total: 1 },
        },
        fromStatedEin: true,
      });
    }

    if (grant.recipientState === null) {
      // Blocking is on state plus phonetic key. With no state there is no block, and
      // comparing against all 1.8M registry rows is not a search this can afford.
      return ok({
        decision: { kind: 'rejected', reason: 'no_candidate', score: null },
        fromStatedEin: false,
      });
    }

    const key = blockingKey(grant.recipientNormalized, grant.recipientState);
    if (key === null) {
      return ok({
        decision: { kind: 'rejected', reason: 'no_candidate', score: null },
        fromStatedEin: false,
      });
    }

    let candidates = blockCache.get(key);
    if (candidates === undefined) {
      candidates = await this.entities.findCandidates(key);
      blockCache.set(key, candidates);
    }
    if (!candidates.ok) return candidates;

    const filing = {
      name: grant.recipientName,
      city: grant.recipientCity,
      state: grant.recipientState,
      zip: grant.recipientZip,
    };

    const scored = candidates.value.map((candidate) => ({
      entityId: candidate.ein,
      score: scoreCandidate(filing, candidate),
    }));

    return ok({ decision: decideLink(scored, thresholds), fromStatedEin: false });
  }
}
