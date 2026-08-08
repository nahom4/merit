import { err, ok, type Result } from '@merit/shared';
import { ModelOutputInvalid, ModelUnavailable } from '../errors.js';
import type {
  ModelCompletion,
  ModelError,
  ModelGateway,
  ModelPriority,
  ModelRequest,
} from '../ports/model.port.js';

export type StubReply =
  { readonly kind: 'raw'; readonly raw: unknown } | { readonly kind: 'error'; readonly error: ModelError };

export interface RecordedRequest {
  readonly purpose: string;
  readonly priority: ModelPriority;
  readonly prompt: string;
}

/**
 * A model gateway that answers with what a test tells it to, and records what it was asked.
 *
 * It runs the caller's own `parse` on the reply, so a unit test exercises the real parse
 * boundary rather than a substitute for it. It does not implement the repair loop -- that is
 * the real gateway's job and is tested against the real gateway.
 */
export class StubModelGateway implements ModelGateway {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly reply: (request: RecordedRequest) => StubReply) {}

  /** Answers every call with the same payload. */
  static answering(raw: unknown): StubModelGateway {
    return new StubModelGateway(() => ({ kind: 'raw', raw }));
  }

  /** The quota is spent. Nothing is scored; work is queued. */
  static outOfQuota(): StubModelGateway {
    return new StubModelGateway(() => ({
      kind: 'error',
      error: new ModelUnavailable('the daily model quota is spent', { reason: 'daily_quota' }),
    }));
  }

  /** Answers with something that will not survive the caller's parse, twice. */
  static answeringBadly(): StubModelGateway {
    return new StubModelGateway(() => ({ kind: 'raw', raw: { fitScore: 'high' } }));
  }

  async complete<T>(request: ModelRequest<T>): Promise<Result<ModelCompletion<T>, ModelError>> {
    const recorded: RecordedRequest = {
      purpose: request.purpose,
      priority: request.priority,
      prompt: request.prompt,
    };
    this.requests.push(recorded);

    const reply = this.reply(recorded);
    if (reply.kind === 'error') return err(reply.error);

    const parsed = request.parse(reply.raw);
    if (!parsed.ok) {
      return err(
        new ModelOutputInvalid(parsed.error.message, {
          purpose: request.purpose,
          ...parsed.error.context,
        }),
      );
    }

    return ok({
      value: parsed.value,
      raw: JSON.stringify(reply.raw),
      cacheHit: false,
      promptTokens: 800,
      responseTokens: 120,
      latencyMs: 40,
      queueWaitMs: 0,
      repairs: 0,
    });
  }
}

/**
 * The cascade's proof. Any call at all is a bug, so it throws rather than returning an error:
 * a model asked about an opportunity the organisation cannot apply for is a broken cascade,
 * regardless of what the rest of the test asserts.
 */
export class NeverCalledModelGateway implements ModelGateway {
  /** Always empty, by construction. Present so a test can hold either fake in one variable
   *  and still assert on what was asked. */
  readonly requests: readonly RecordedRequest[] = [];

  async complete<T>(request: ModelRequest<T>): Promise<Result<ModelCompletion<T>, ModelError>> {
    throw new Error(`the model was called for "${request.purpose}" when it must not have been`);
  }
}
