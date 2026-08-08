import { err, ok, type Result } from '@merit/shared';
import { RepositoryUnavailable } from '@merit/application';
import type {
  Clock,
  ModelCallLog,
  ModelCallRecord,
  ModelResponseCache,
  ModelSpend,
} from '@merit/application';
import type { Database } from './database.js';

/** One row per model call, cache hits included and logged with zero token spend. */
export class LibsqlModelCallLog implements ModelCallLog {
  constructor(private readonly db: Database) {}

  async record(call: ModelCallRecord): Promise<Result<void, RepositoryUnavailable>> {
    try {
      await this.db.execute({
        sql: `INSERT INTO model_calls (purpose, priority, model, cache_hit, prompt_tokens,
                                       response_tokens, latency_ms, queue_wait_ms, repairs,
                                       outcome, occurred_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          call.purpose,
          call.priority,
          call.model,
          call.cacheHit ? 1 : 0,
          call.promptTokens,
          call.responseTokens,
          call.latencyMs,
          call.queueWaitMs,
          call.repairs,
          call.outcome,
          call.occurredAt,
        ],
      });
      return ok(undefined);
    } catch (cause) {
      return err(unavailable('record', cause));
    }
  }

  async spendSince(iso: string): Promise<Result<ModelSpend, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: `SELECT COUNT(*) AS calls,
                     COALESCE(SUM(cache_hit), 0) AS cache_hits,
                     COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
                     COALESCE(SUM(response_tokens), 0) AS response_tokens,
                     COALESCE(SUM(repairs), 0) AS repairs,
                     COALESCE(SUM(outcome <> 'ok'), 0) AS failures
              FROM model_calls WHERE occurred_at >= ?`,
        args: [iso],
      });

      const row = result.rows[0];
      return ok({
        calls: Number(row?.['calls'] ?? 0),
        cacheHits: Number(row?.['cache_hits'] ?? 0),
        promptTokens: Number(row?.['prompt_tokens'] ?? 0),
        responseTokens: Number(row?.['response_tokens'] ?? 0),
        repairs: Number(row?.['repairs'] ?? 0),
        failures: Number(row?.['failures'] ?? 0),
      });
    } catch (cause) {
      return err(unavailable('spendSince', cause));
    }
  }
}

/**
 * The content-hash cache, persisted. In memory it would be empty on every cold start of a
 * serverless container, which is exactly when the daily quota is tightest.
 */
export class LibsqlModelResponseCache implements ModelResponseCache {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async find(key: string): Promise<Result<string | null, RepositoryUnavailable>> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT response FROM model_response_cache WHERE key = ?',
        args: [key],
      });
      const row = result.rows[0];
      return ok(row === undefined ? null : String(row['response']));
    } catch (cause) {
      return err(unavailable('find', cause));
    }
  }

  async save(key: string, response: string): Promise<Result<void, RepositoryUnavailable>> {
    try {
      await this.db.execute({
        sql: `INSERT INTO model_response_cache (key, response, created_at) VALUES (?, ?, ?)
              ON CONFLICT (key) DO UPDATE SET response = excluded.response, created_at = excluded.created_at`,
        args: [key, response, this.clock.now().toISOString()],
      });
      return ok(undefined);
    } catch (cause) {
      return err(unavailable('save', cause));
    }
  }
}

const unavailable = (operation: string, cause: unknown): RepositoryUnavailable =>
  new RepositoryUnavailable(cause instanceof Error ? cause.message : String(cause), {
    operation,
    table: 'model_calls',
  });
