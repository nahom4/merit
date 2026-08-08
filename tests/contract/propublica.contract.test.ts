import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProPublicaOrganizationSchema } from '@merit/infrastructure';

/**
 * ProPublica's Nonprofit Explorer is not ours and it drifts.
 *
 * These call the live API and assert that the fields the financial trend depends on still
 * exist with the shapes expected, then regenerate the fixtures the integration tests run
 * against. They run nightly and on demand, never on the PR path: a ProPublica outage must
 * not block a merge (docs/testing.md).
 *
 * A failure here is real news — the source changed.
 */
const BASE = 'https://projects.propublica.org/nonprofits/api/v2';
const TIMEOUT = 60_000;

/** The Duke Endowment: a large 990-PF filer with a long history, in the region the S1
 *  benchmark is drawn from. The Museum of Modern Art: a 990 filer, whose summary carries no
 *  grants-paid figure at all. Between them they cover both branches of the gateway. */
const DUKE_ENDOWMENT = '560529965';
const MUSEUM_OF_MODERN_ART = '131624100';

const FIELDS = [
  'tax_prd_yr',
  'formtype',
  'totrevenue',
  'totfuncexpns',
  'totassetsend',
  'contrpdpbks',
] as const;

const fetchOrganization = async (ein: string): Promise<unknown> => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT);
  try {
    const response = await fetch(`${BASE}/organizations/${ein}.json`, {
      signal: abort.signal,
      headers: { accept: 'application/json' },
    });
    expect(response.status).toBe(200);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

/** Trimmed to the fields Merit reads, which is what the integration fixtures hold. */
const trim = (payload: unknown, limit: number): unknown => {
  const parsed = ProPublicaOrganizationSchema.parse(payload);
  const raw = payload as { organization: Record<string, unknown> };
  return {
    organization: {
      ein: raw.organization['ein'],
      name: raw.organization['name'],
      state: raw.organization['state'],
      city: raw.organization['city'],
    },
    filings_with_data: parsed.filings_with_data.slice(0, limit).map((filing) => ({
      tax_prd_yr: filing.tax_prd_yr,
      formtype: filing.formtype,
      totrevenue: filing.totrevenue,
      totfuncexpns: filing.totfuncexpns,
      totassetsend: filing.totassetsend,
      contrpdpbks: filing.contrpdpbks,
    })),
    filings_without_data: [],
  };
};

describe('ProPublica Nonprofit Explorer', () => {
  it('still serves an organisation at the path the gateway builds', async () => {
    const payload = await fetchOrganization(DUKE_ENDOWMENT);
    expect(ProPublicaOrganizationSchema.safeParse(payload).success).toBe(true);
  });

  it('still carries every field the financial trend is computed from', async () => {
    const payload = (await fetchOrganization(DUKE_ENDOWMENT)) as {
      filings_with_data: readonly Record<string, unknown>[];
    };
    const filing = payload.filings_with_data[0];
    expect(filing).toBeDefined();

    for (const field of FIELDS) {
      expect(Object.hasOwn(filing!, field)).toBe(true);
    }
  });

  it('still states 990-PF grants paid as a number in whole dollars', async () => {
    const parsed = ProPublicaOrganizationSchema.parse(await fetchOrganization(DUKE_ENDOWMENT));
    const pf = parsed.filings_with_data.find((filing) => filing.formtype === 2);

    expect(pf).toBeDefined();
    expect(typeof pf!.contrpdpbks).toBe('number');
    // Whole dollars, not cents: a nine-figure foundation's payout is not a nine-digit cent value.
    expect(Number.isInteger(pf!.contrpdpbks)).toBe(true);
  });

  it('still uses form type 2 for a 990-PF filer and 0 for a 990 filer', async () => {
    // The gateway maps these codes to what the fields mean. If they change, it reads the
    // wrong column and reports a funder's finances wrongly rather than failing.
    const pf = ProPublicaOrganizationSchema.parse(await fetchOrganization(DUKE_ENDOWMENT));
    const full = ProPublicaOrganizationSchema.parse(await fetchOrganization(MUSEUM_OF_MODERN_ART));

    expect(pf.filings_with_data.every((filing) => filing.formtype === 2)).toBe(true);
    expect(full.filings_with_data.some((filing) => filing.formtype === 0)).toBe(true);
  });

  it('still omits grants paid from a 990 filer’s summary', async () => {
    const parsed = ProPublicaOrganizationSchema.parse(await fetchOrganization(MUSEUM_OF_MODERN_ART));
    const full = parsed.filings_with_data.find((filing) => filing.formtype === 0)!;

    expect(full.contrpdpbks).toBeNull();
  });

  it('regenerates the fixtures the integration tests run against', async () => {
    const duke = trim(await fetchOrganization(DUKE_ENDOWMENT), 9);
    const moma = trim(await fetchOrganization(MUSEUM_OF_MODERN_ART), 4);

    writeFileSync(
      resolve('tests/fixtures/propublica/duke-endowment-560529965.json'),
      `${JSON.stringify(duke, null, 2)}\n`,
    );
    writeFileSync(
      resolve('tests/fixtures/propublica/museum-of-modern-art-131624100.json'),
      `${JSON.stringify(moma, null, 2)}\n`,
    );

    expect(ProPublicaOrganizationSchema.safeParse(duke).success).toBe(true);
    expect(ProPublicaOrganizationSchema.safeParse(moma).success).toBe(true);
  });
});
