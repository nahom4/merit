import type { ParseError, Result } from '@merit/shared';
import type { ModelOutputInvalid, ModelUnavailable } from '../errors.js';

/**
 * A user waiting on a response does not sit behind a nightly job. Two priorities are enough,
 * and the important property is that a 400-item overnight sweep already queued must not add
 * minutes to a click.
 */
export type ModelPriority = 'interactive' | 'batch';

export type ModelError = ModelUnavailable | ModelOutputInvalid;

export interface ModelRequest<T> {
  /** What this call is for, logged on every `model_calls` row: `fit_score`, `rubric`, ... */
  readonly purpose: string;
  readonly priority: ModelPriority;
  readonly prompt: string;
  /** The response shape, sent to the model and part of the cache key. */
  readonly responseContract: string;
  /**
   * The parse boundary, supplied by the caller because only the caller knows what the answer
   * means. Its error message is what the repair loop re-prompts with, so it must name the
   * offending field rather than say "invalid".
   */
  readonly parse: (raw: unknown) => Result<T, ParseError>;
}

export interface ModelCompletion<T> {
  readonly value: T;
  /** The response text the value was parsed from. The orchestrator caches this rather than the
   *  parsed value, so a cache hit takes the same parse path as a miss. */
  readonly raw: string;
  /** True when no quota was spent. Logged, because a run log that omits cache hits reports
   *  its numbers wrong in the flattering direction. */
  readonly cacheHit: boolean;
  readonly promptTokens: number;
  readonly responseTokens: number;
  readonly latencyMs: number;
  readonly queueWaitMs: number;
  /** How many times the response had to be repaired. One is normal; two is a failure. */
  readonly repairs: number;
}

/**
 * Every model call in Merit goes through this port. Nothing calls a model SDK directly.
 *
 * It is defined in terms of purpose and result rather than tokens and endpoints, which is what
 * lets the orchestrator -- token bucket, priority queue, content-hash cache -- be a decorator
 * around the gateway implementing the same interface. A use case asks for "a fit score for this
 * pair, schema-validated". It does not know a bucket exists, and it must not.
 */
export interface ModelGateway {
  complete<T>(request: ModelRequest<T>): Promise<Result<ModelCompletion<T>, ModelError>>;
}
