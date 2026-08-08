import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApplicantType } from '@merit/domain';
import {
  GrantsGovOpportunitySchema,
  GrantsGovSearchResponseSchema,
  toFederalOpportunity,
} from '@merit/infrastructure';
import { RECORDED_SEARCHES } from '../support/grants-gov-fixture-server.js';

/**
 * Grants.gov is not ours and it drifts.
 *
 * These call the live API and assert that the fields screening and scoring depend on still
 * exist with the shapes expected, then regenerate the fixtures the integration and E2E tiers
 * run against. They run nightly and on demand, never on the PR path: a federal outage must not
 * block a merge (docs/testing.md).
 *
 * A failure here is real news — the feed changed, and something Merit screens on may have moved.
 */
const BASE = 'https://api.grants.gov/v1/api';
const TIMEOUT = 60_000;
const FIXTURES = resolve('tests/fixtures/grants-gov');

const post = async (path: string, body: Readonly<Record<string, unknown>>): Promise<unknown> => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT);
  try {
    const response = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      signal: abort.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

/** The searches the fixtures are recorded from, with the bodies that produced them. */
const SEARCH_BODIES: Readonly<Record<string, Record<string, unknown>>> = {
  literacy: { keyword: 'literacy', oppStatuses: 'posted', rows: 5, eligibilities: '12' },
  'animal food safety': { keyword: 'animal food safety', oppStatuses: 'posted', rows: 5 },
  'Delta States Rural': { keyword: 'Delta States Rural', oppStatuses: 'posted', rows: 5 },
};

const HIT_FIELDS = [
  'id',
  'number',
  'title',
  'agency',
  'agencyCode',
  'openDate',
  'closeDate',
  'oppStatus',
  'docType',
  'cfdaList',
] as const;

const SYNOPSIS_FIELDS = [
  'agencyName',
  'synopsisDesc',
  'responseDate',
  'postingDate',
  'archiveDate',
  'awardCeiling',
  'awardFloor',
  'applicantEligibilityDesc',
  'applicantTypes',
  'fundingActivityCategories',
] as const;

const trimSearch = (payload: unknown): unknown => {
  const parsed = payload as { errorcode: unknown; msg: unknown; data: Record<string, unknown> };
  const hits = parsed.data['oppHits'] as readonly Record<string, unknown>[];
  return {
    errorcode: parsed.errorcode,
    msg: parsed.msg,
    data: {
      hitCount: parsed.data['hitCount'],
      startRecord: parsed.data['startRecord'],
      oppHits: hits.map((hit) => Object.fromEntries(HIT_FIELDS.map((field) => [field, hit[field] ?? null]))),
    },
  };
};

const trimDetail = (payload: unknown): unknown => {
  const parsed = payload as { errorcode: unknown; msg: unknown; data: Record<string, unknown> };
  const data = parsed.data;
  const synopsis = data['synopsis'] as Record<string, unknown>;
  const coded = (values: unknown): unknown =>
    ((values ?? []) as readonly Record<string, unknown>[]).map((value) => ({
      id: value['id'],
      description: value['description'],
    }));

  return {
    errorcode: parsed.errorcode,
    msg: parsed.msg,
    data: {
      id: data['id'],
      opportunityNumber: data['opportunityNumber'],
      opportunityTitle: data['opportunityTitle'],
      docType: data['docType'] ?? null,
      ost: data['ost'] ?? null,
      synopsis: {
        ...Object.fromEntries(SYNOPSIS_FIELDS.map((field) => [field, synopsis[field] ?? null])),
        estimatedFunding: synopsis['estimatedFunding'] ?? null,
        numberOfAwards: synopsis['numberOfAwards'] ?? null,
        costSharing: synopsis['costSharing'] ?? null,
        applicantTypes: coded(synopsis['applicantTypes']),
        fundingActivityCategories: coded(synopsis['fundingActivityCategories']),
      },
      cfdas: ((data['cfdas'] ?? []) as readonly Record<string, unknown>[]).map((cfda) => ({
        cfdaNumber: cfda['cfdaNumber'] ?? null,
        programTitle: cfda['programTitle'] ?? null,
      })),
      synopsisAttachmentFolders: (
        (data['synopsisAttachmentFolders'] ?? []) as readonly Record<string, unknown>[]
      ).map((folder) => ({
        folderType: folder['folderType'] ?? null,
        folderName: folder['folderName'] ?? null,
        synopsisAttachments: (
          (folder['synopsisAttachments'] ?? []) as readonly Record<string, unknown>[]
        ).map((attachment) => ({
          id: attachment['id'],
          mimeType: attachment['mimeType'] ?? null,
          fileName: attachment['fileName'] ?? null,
          fileDescription: attachment['fileDescription'] ?? null,
        })),
      })),
    },
  };
};

describe('Grants.gov search2', () => {
  it('still returns opportunities in the shape the gateway parses', async () => {
    const payload = await post('search2', SEARCH_BODIES['literacy']!);

    expect(GrantsGovSearchResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('still carries the federal program number on every hit', async () => {
    // `cfdaList` is the join key to award history in S5, and the single most valuable field
    // in this payload.
    const parsed = GrantsGovSearchResponseSchema.parse(await post('search2', SEARCH_BODIES['literacy']!));

    expect(parsed.data.oppHits.length).toBeGreaterThan(0);
    expect(parsed.data.oppHits.some((hit) => (hit.cfdaList ?? []).length > 0)).toBe(true);
  });

  it('still offers the applicant eligibility facet Merit screens on', async () => {
    const payload = (await post('search2', { keyword: 'health', oppStatuses: 'posted', rows: 1 })) as {
      data: { eligibilities?: readonly { value: string; label: string }[] };
    };

    const facet = payload.data.eligibilities ?? [];
    expect(facet.length).toBeGreaterThan(0);
    // Every code the feed advertises must be one the screening table knows. A new one means
    // eligibility for some announcement can no longer be decided, which is real news.
    expect(facet.filter((entry) => ApplicantType.label(entry.value) === null)).toEqual([]);
  });
});

describe('Grants.gov fetchOpportunity', () => {
  it('still returns eligibility, award figures, and attachment metadata', async () => {
    const payload = await post('fetchOpportunity', { opportunityId: '362839' });
    const parsed = GrantsGovOpportunitySchema.safeParse(payload);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.data.synopsis.applicantTypes?.length ?? 0).toBeGreaterThan(0);
    expect(typeof parsed.data.data.synopsis.applicantEligibilityDesc).toBe('string');
    expect(parsed.data.data.cfdas?.length ?? 0).toBeGreaterThan(0);
    // S4 downloads the rubric from the full announcement. Without this metadata the drafting
    // feature has nothing to extract from.
    expect(parsed.data.data.synopsisAttachmentFolders?.length ?? 0).toBeGreaterThan(0);
  });

  it('still maps cleanly onto the domain type', async () => {
    const parsed = GrantsGovOpportunitySchema.parse(
      await post('fetchOpportunity', { opportunityId: '362839' }),
    );
    const mapped = toFederalOpportunity(parsed);

    expect(mapped.ok).toBe(true);
    expect(mapped.ok ? mapped.value.programNumbers.length : 0).toBeGreaterThan(0);
  });

  it('regenerates the fixtures the integration and E2E tiers run against', async () => {
    const ids = new Set<string>();

    for (const [keyword, file] of Object.entries(RECORDED_SEARCHES)) {
      const payload = await post('search2', SEARCH_BODIES[keyword]!);
      const trimmed = trimSearch(payload);
      writeFileSync(resolve(FIXTURES, file), `${JSON.stringify(trimmed, null, 2)}\n`);

      expect(GrantsGovSearchResponseSchema.safeParse(trimmed).success).toBe(true);
      for (const hit of GrantsGovSearchResponseSchema.parse(trimmed).data.oppHits) ids.add(hit.id);
    }

    for (const id of ids) {
      const trimmed = trimDetail(await post('fetchOpportunity', { opportunityId: id }));
      writeFileSync(
        resolve(FIXTURES, `fetch-opportunity-${id}.json`),
        `${JSON.stringify(trimmed, null, 2)}\n`,
      );

      expect(GrantsGovOpportunitySchema.safeParse(trimmed).success).toBe(true);
    }
  });
});
