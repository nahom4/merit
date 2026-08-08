import { z } from 'zod';
import { err, ok, type Result } from '@merit/shared';
import { ModelOutputInvalid, ModelUnavailable } from '@merit/application';
import type { Clock, ModelCompletion, ModelError, ModelGateway, ModelRequest } from '@merit/application';

export interface GeminiGatewayOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly clock: Clock;
}

/**
 * The envelope Gemini's REST API returns. Parsed like every other external payload: a response
 * whose shape has changed is a failure, not a value to be dug out of optimistically.
 */
const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional() })).optional() })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
    })
    .optional(),
  error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional(),
});

/**
 * The model call itself, and the repair loop around it.
 *
 * One retry, with the specific error. When a response fails its schema the model is asked
 * again with the exact validation issue quoted back to it -- "fitScore must be an integer 0-100;
 * you returned 'high'" -- and parsed again. If it fails twice the call returns an error value.
 * It does not coerce, accept partial output, or fall back to a default: every one of those is
 * a silent fallback, and bad data in the database is worse than a call that failed.
 *
 * Rate limiting, caching, queueing, and logging are not here. They are the orchestrator's, so
 * that this class does one boring job well.
 */
export class GeminiGateway implements ModelGateway {
  constructor(private readonly options: GeminiGatewayOptions) {}

  async complete<T>(request: ModelRequest<T>): Promise<Result<ModelCompletion<T>, ModelError>> {
    const startedMs = this.options.clock.now().getTime();

    let prompt = `${request.prompt}\n\n${request.responseContract}`;
    let promptTokens = 0;
    let responseTokens = 0;
    let lastIssue = 'the response could not be parsed';

    // Two attempts: the call, and one repair. A third would be hope rather than engineering.
    for (let repairs = 0; repairs <= 1; repairs += 1) {
      const generated = await this.generate(prompt);
      if (!generated.ok) return generated;

      promptTokens += generated.value.promptTokens;
      responseTokens += generated.value.responseTokens;

      const raw = stripFences(generated.value.text);
      const parsed = parseJson(raw);

      if (parsed.ok) {
        const value = request.parse(parsed.value);
        if (value.ok) {
          return ok({
            value: value.value,
            raw,
            cacheHit: false,
            promptTokens,
            responseTokens,
            latencyMs: this.options.clock.now().getTime() - startedMs,
            queueWaitMs: 0,
            repairs,
          });
        }
        lastIssue = value.error.message;
      } else {
        lastIssue = 'the response was not valid JSON';
      }

      prompt =
        `${request.prompt}\n\n${request.responseContract}\n\n` +
        `Your previous answer was rejected: ${lastIssue}\n` +
        `You returned:\n${raw.slice(0, 2_000)}\n` +
        'Reply again with JSON only, correcting exactly that problem.';
    }

    return err(
      new ModelOutputInvalid('the model did not return a valid response after one repair', {
        purpose: request.purpose,
        model: this.options.model,
        issue: lastIssue,
      }),
    );
  }

  private async generate(
    prompt: string,
  ): Promise<Result<{ text: string; promptTokens: number; responseTokens: number }, ModelError>> {
    const url =
      `${this.options.baseUrl.replace(/\/$/, '')}/models/${this.options.model}:generateContent` +
      `?key=${encodeURIComponent(this.options.apiKey)}`;

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            // Structured output, and a temperature of zero: the same profile against the same
            // announcement should not produce a different score on a Tuesday.
            responseMimeType: 'application/json',
            temperature: 0,
          },
        }),
      });

      if (!response.ok) {
        return err(
          new ModelUnavailable(`Gemini returned ${response.status}`, {
            status: response.status,
            // 429 here means the provider disagrees with our bucket. It is still unavailability,
            // not something to retry into.
            reason: response.status === 429 ? 'provider_rate_limit' : 'http_error',
          }),
        );
      }

      const parsed = GeminiResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        return err(
          new ModelUnavailable('Gemini returned a payload that did not match the expected shape', {
            issue: parsed.error.issues[0]?.message ?? 'unknown',
          }),
        );
      }
      if (parsed.data.error !== undefined) {
        return err(
          new ModelUnavailable(parsed.data.error.message ?? 'Gemini reported an error', {
            code: parsed.data.error.code ?? 0,
          }),
        );
      }

      const text = parsed.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text === undefined || text.trim().length === 0) {
        return err(
          new ModelUnavailable('Gemini returned no content', {
            finishReason: parsed.data.candidates?.[0]?.finishReason ?? 'not stated',
          }),
        );
      }

      return ok({
        text,
        promptTokens: parsed.data.usageMetadata?.promptTokenCount ?? 0,
        responseTokens: parsed.data.usageMetadata?.candidatesTokenCount ?? 0,
      });
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      return err(
        new ModelUnavailable(aborted ? 'Gemini did not respond in time' : 'Gemini could not be reached', {
          reason: aborted ? 'timeout' : 'transport',
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Models wrap JSON in a fenced block often enough that unwrapping it is not a fallback --
 *  the content is unchanged, only its packaging. */
const stripFences = (text: string): string => {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced === null ? trimmed : (fenced[1] ?? trimmed);
};

const parseJson = (raw: string): Result<unknown, string> => {
  try {
    return ok(JSON.parse(raw));
  } catch {
    return err('not valid JSON');
  }
};
