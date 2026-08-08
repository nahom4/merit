import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProPublicaFinancialsGateway } from '@merit/infrastructure';

/**
 * The ProPublica gateway against a real HTTP server serving real recorded payloads.
 *
 * No mocks at this tier: the server is a real one on a real socket, and the bodies are actual
 * responses from the live API trimmed to the fields Merit reads
 * (`tests/fixtures/propublica/`). The contract test keeps those fixtures honest.
 */
const fixture = (name: string): string =>
  readFileSync(resolve(`tests/fixtures/propublica/${name}.json`), 'utf8');

const DUKE = fixture('duke-endowment-560529965');
const MOMA = fixture('museum-of-modern-art-131624100');

/** Routes chosen by EIN so one server covers every case, including the failure modes. */
let server: Server;
let baseUrl: string;
let flakyCallCount = 0;

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? '';

    const send = (status: number, body: string, contentType = 'application/json') => {
      response.writeHead(status, { 'content-type': contentType });
      response.end(body);
    };

    if (url.includes('560529965')) return send(200, DUKE);
    if (url.includes('131624100')) return send(200, MOMA);
    if (url.includes('404404404')) return send(404, JSON.stringify({ message: 'not found' }));
    if (url.includes('500500500')) return send(500, JSON.stringify({ message: 'server error' }));
    if (url.includes('111111111'))
      return send(200, JSON.stringify({ organization: { ein: 'not a number' } }));
    if (url.includes('222222222')) {
      // A form type outside the three the gateway knows how to read.
      return send(
        200,
        JSON.stringify({
          organization: { ein: 222222222, name: 'Odd Filer' },
          filings_with_data: [
            {
              tax_prd_yr: 2023,
              formtype: 47,
              totrevenue: 1,
              totfuncexpns: 1,
              totassetsend: 1,
              contrpdpbks: 1,
            },
          ],
        }),
      );
    }
    if (url.includes('333333333')) {
      // Fails once, then succeeds: proves the retry is real rather than declared.
      flakyCallCount += 1;
      return flakyCallCount === 1 ? send(503, '{}') : send(200, DUKE);
    }
    if (url.includes('999999999')) {
      // Never responds, so the timeout is exercised rather than described.
      return;
    }
    return send(404, '{}');
  });

  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind a port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((closed) => server.close(() => closed()));
});

const gateway = (overrides: { timeoutMs?: number; retries?: number } = {}) =>
  new ProPublicaFinancialsGateway({
    baseUrl,
    timeoutMs: overrides.timeoutMs ?? 5_000,
    retries: overrides.retries ?? 0,
  });

describe('reading a 990-PF filer', () => {
  it('returns one entry per filing year', async () => {
    const result = await gateway().fetchFinancials('560529965');
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.length).toBeGreaterThan(1);
    expect(result.value.every((year) => year.formType === 'form_990_pf')).toBe(true);
  });

  it('converts whole dollars into integer cents', async () => {
    const result = await gateway().fetchFinancials('560529965');
    if (!result.ok) throw new Error(result.error.message);

    // The Duke Endowment's 2022 return: $212,293,248 of contributions and grants paid.
    const y2022 = result.value.find((year) => year.taxYear === 2022)!;
    expect(y2022.grantsPaidCents).toBe(212_293_248_00);
    expect(y2022.totalAssetsEndCents).toBe(3_619_520_233_00);
    expect(Number.isInteger(y2022.grantsPaidCents)).toBe(true);
  });
});

describe('reading a 990 filer', () => {
  it('reads its revenue, expenses, and assets', async () => {
    const result = await gateway().fetchFinancials('131624100');
    if (!result.ok) throw new Error(result.error.message);

    const latest = result.value[0]!;
    expect(latest.formType).toBe('form_990');
    expect(latest.totalRevenueCents).not.toBeNull();
  });

  it('reports no grants-paid figure, because a 990 does not carry one', async () => {
    // Reporting zero here would read as "this funder gave nothing", which is a false claim:
    // a 990 filer's grants are on Schedule I, not in this summary.
    const result = await gateway().fetchFinancials('131624100');
    if (!result.ok) throw new Error(result.error.message);

    for (const year of result.value) expect(year.grantsPaidCents).toBeNull();
  });
});

describe('failure modes', () => {
  it('returns a value, never throws, when ProPublica has no record of the EIN', async () => {
    const result = await gateway().fetchFinancials('404404404');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('financials_unavailable');
    expect(!result.ok && result.error.context['status']).toBe(404);
  });

  it('does not retry a 404, which is a fact rather than a hiccup', async () => {
    const result = await gateway({ retries: 3 }).fetchFinancials('404404404');
    expect(!result.ok && result.error.context['retryable']).toBe(false);
  });

  it('rejects a payload that no longer matches the schema instead of guessing at it', async () => {
    const result = await gateway().fetchFinancials('111111111');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('schema');
  });

  it('fails loudly on an unrecognised form type rather than dropping the year', async () => {
    const result = await gateway().fetchFinancials('222222222');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.context['formType']).toBe(47);
  });

  it('retries a server error and succeeds on the second attempt', async () => {
    const result = await gateway({ retries: 2 }).fetchFinancials('333333333');

    expect(result.ok).toBe(true);
    expect(flakyCallCount).toBe(2);
  });

  it('gives up on a server that never answers, within its timeout', async () => {
    const started = Date.now();
    const result = await gateway({ timeoutMs: 300 }).fetchFinancials('999999999');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('in time');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
