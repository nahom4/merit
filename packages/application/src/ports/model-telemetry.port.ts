import type { Result } from '@merit/shared';
import type { RepositoryUnavailable } from '../errors.js';
import type { ModelPriority } from './model.port.js';

/**
 * One row per model call, cache hits included. Merit.md section 15 names these columns, and
 * they are the run log's numbers: without them "the sweep ran" and "the sweep ran and silently
 * degraded on quota exhaustion" look identical from the outside.
 */
export interface ModelCallRecord {
  readonly purpose: string;
  readonly priority: ModelPriority;
  readonly model: string;
  readonly cacheHit: boolean;
  readonly promptTokens: number;
  readonly responseTokens: number;
  readonly latencyMs: number;
  readonly queueWaitMs: number;
  readonly repairs: number;
  readonly outcome: 'ok' | 'invalid_output' | 'unavailable';
  readonly occurredAt: string;
}

export interface ModelSpend {
  readonly calls: number;
  readonly cacheHits: number;
  readonly promptTokens: number;
  readonly responseTokens: number;
  readonly repairs: number;
  readonly failures: number;
}

export interface ModelCallLog {
  record(call: ModelCallRecord): Promise<Result<void, RepositoryUnavailable>>;
  /** Spend since an ISO timestamp, for the run log surface. */
  spendSince(iso: string): Promise<Result<ModelSpend, RepositoryUnavailable>>;
}

/**
 * Content-hash cache over model responses: identical inputs never pay twice.
 *
 * The raw response text is stored rather than the parsed value, so a hit takes the same parse
 * path as a miss -- one code path, and a stored response that no longer parses fails loudly
 * instead of being trusted because it was once valid.
 */
export interface ModelResponseCache {
  find(key: string): Promise<Result<string | null, RepositoryUnavailable>>;
  save(key: string, response: string): Promise<Result<void, RepositoryUnavailable>>;
}
