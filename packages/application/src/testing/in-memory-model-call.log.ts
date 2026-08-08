import { ok, type Result } from '@merit/shared';
import type { RepositoryUnavailable } from '../errors.js';
import type { ModelCallLog, ModelCallRecord, ModelSpend } from '../ports/model-telemetry.port.js';
import type { ModelResponseCache } from '../ports/model-telemetry.port.js';

/** Every call, in order, so a test can assert that cache hits were logged too. */
export class InMemoryModelCallLog implements ModelCallLog {
  readonly calls: ModelCallRecord[] = [];

  async record(call: ModelCallRecord): Promise<Result<void, RepositoryUnavailable>> {
    this.calls.push(call);
    return ok(undefined);
  }

  async spendSince(iso: string): Promise<Result<ModelSpend, RepositoryUnavailable>> {
    const since = this.calls.filter((call) => call.occurredAt >= iso);
    return ok({
      calls: since.length,
      cacheHits: since.filter((call) => call.cacheHit).length,
      promptTokens: since.reduce((total, call) => total + call.promptTokens, 0),
      responseTokens: since.reduce((total, call) => total + call.responseTokens, 0),
      repairs: since.reduce((total, call) => total + call.repairs, 0),
      failures: since.filter((call) => call.outcome !== 'ok').length,
    });
  }
}

export class InMemoryModelResponseCache implements ModelResponseCache {
  private readonly entries = new Map<string, string>();

  get size(): number {
    return this.entries.size;
  }

  async find(key: string): Promise<Result<string | null, RepositoryUnavailable>> {
    return ok(this.entries.get(key) ?? null);
  }

  async save(key: string, response: string): Promise<Result<void, RepositoryUnavailable>> {
    this.entries.set(key, response);
    return ok(undefined);
  }
}
