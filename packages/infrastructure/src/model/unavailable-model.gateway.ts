import { err, type Result } from '@merit/shared';
import { ModelUnavailable } from '@merit/application';
import type { ModelCompletion, ModelError, ModelGateway, ModelRequest } from '@merit/application';

/**
 * The gateway used when no model credential is configured.
 *
 * Merit is expected to run without one: screening, storage, and everything already computed
 * work with no model at all. An unset key is the most complete form of quota exhaustion, and it
 * degrades the same way -- persisted results are served, new work is queued, and the board says
 * "not scored yet" rather than failing the page or, worse, showing a zero.
 */
export class UnavailableModelGateway implements ModelGateway {
  constructor(private readonly reason: string) {}

  async complete<T>(request: ModelRequest<T>): Promise<Result<ModelCompletion<T>, ModelError>> {
    return err(new ModelUnavailable(this.reason, { purpose: request.purpose, reason: 'not_configured' }));
  }
}
