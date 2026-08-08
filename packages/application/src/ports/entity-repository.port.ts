import type { Result } from '@merit/shared';
import type { LinkDecision } from '@merit/domain';
import type { RepositoryUnavailable } from '../errors.js';

/** A registry row, reduced to what linkage compares against. */
export interface RegistryCandidate {
  readonly ein: string;
  readonly name: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
}

/** A grant whose recipient string has not yet been decided. */
export interface UnresolvedGrant {
  readonly grantRecordId: string;
  readonly recipientName: string;
  readonly recipientNormalized: string;
  readonly recipientCity: string | null;
  readonly recipientState: string | null;
  readonly recipientZip: string | null;
  readonly statedRecipientEin: string | null;
}

export interface RegistryEntityRow {
  readonly ein: string;
  readonly canonicalName: string;
  readonly normalizedName: string;
  readonly nteeCode: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
  readonly revenueCents: number | null;
  readonly blockingKey: string | null;
}

export interface EntityRepository {
  upsertEntities(entities: readonly RegistryEntityRow[]): Promise<Result<number, RepositoryUnavailable>>;
  /** Streams work in batches so a 1.4M-row corpus never lands in memory at once. */
  unresolvedGrants(batchSize: number): AsyncGenerator<readonly UnresolvedGrant[]>;
  findCandidates(key: string): Promise<Result<readonly RegistryCandidate[], RepositoryUnavailable>>;
  saveLinks(
    links: readonly { grantRecordId: string; decision: LinkDecision }[],
  ): Promise<Result<number, RepositoryUnavailable>>;
  /**
   * Discards machine-made decisions so they can be rebuilt under new thresholds. Rows a
   * human adjudicated are left alone: refitting a threshold is not a reason to throw away
   * the judgements the review queue exists to collect.
   */
  clearMachineLinks(): Promise<Result<number, RepositoryUnavailable>>;
  countEntities(): Promise<Result<number, RepositoryUnavailable>>;
}
