import { createServer, type Server } from 'node:http';

/**
 * A real HTTP server speaking Gemini's `generateContent` envelope.
 *
 * Unlike the Grants.gov and ProPublica fixtures, these bytes are not a recording of a live
 * call: Gemini needs a credential, and one is deliberately not required to run Merit's test
 * suite. The envelope's shape is therefore the one documented by the API and asserted against
 * the live service by `tests/contract/gemini.contract.test.ts`, which is skipped unless
 * `GEMINI_API_KEY` is set. That contract test is what keeps this shape honest; this server is
 * what lets the repair loop, the cache, and the board be exercised without a key.
 */
export type GeminiReply = string | { readonly status: number; readonly body: string };

export interface GeminiScript {
  /** One entry per call, in order. The last is repeated if more calls arrive. */
  readonly replies: readonly GeminiReply[];
  /**
   * Answers by what was asked rather than by call order.
   *
   * S4 makes four different kinds of call in one page load -- extract a rubric, draft a section,
   * critique, revise -- and each one is parsed by a different schema, so a positional script
   * cannot serve them: insert one extra call anywhere and every later reply is being read by the
   * wrong parser. Returning `null` falls through to `replies`.
   */
  readonly route?: (prompt: string) => GeminiReply | null;
}

export interface GeminiFixtureServer {
  readonly server: Server;
  readonly prompts: string[];
}

export const geminiEnvelope = (text: string, promptTokens = 800, responseTokens = 120): string =>
  JSON.stringify({
    candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: responseTokens,
      totalTokenCount: promptTokens + responseTokens,
    },
  });

export const startGeminiFixtureServer = async (
  port: number,
  script: GeminiScript,
): Promise<GeminiFixtureServer> => {
  const prompts: string[] = [];
  let call = 0;

  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      try {
        const parsed = JSON.parse(body) as {
          contents?: { parts?: { text?: string }[] }[];
        };
        prompts.push(parsed.contents?.[0]?.parts?.[0]?.text ?? '');
      } catch {
        prompts.push('');
      }

      const prompt = prompts[prompts.length - 1] ?? '';
      const routed = script.route?.(prompt) ?? null;
      const reply = routed ?? script.replies[Math.min(call, script.replies.length - 1)] ?? '{}';
      call += 1;

      if (typeof reply === 'string') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(reply);
        return;
      }
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(reply.body);
    });
  });

  await new Promise<void>((ready) => server.listen(port, '127.0.0.1', ready));
  return { server, prompts };
};
