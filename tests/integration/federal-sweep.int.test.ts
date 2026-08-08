import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrapOrThrow } from '@merit/shared';
import { Organization } from '@merit/domain';
import { ScreenFederalOpportunities, StubModelGateway, SweepFederalOpportunities } from '@merit/application';
import {
  GrantsGovOpportunityGateway,
  LibsqlOpportunityRepository,
  LibsqlRegistryStatusReader,
  systemClock,
  uuidIdGenerator,
} from '@merit/infrastructure';
import { freshDatabase, type FreshDatabase } from '../support/fresh-database.js';
import {
  startGrantsGovFixtureServer,
  stopServer,
  SWEEP_KEYWORDS,
} from '../support/grants-gov-fixture-server.js';

/**
 * The whole S3 pipeline against real infrastructure: real HTTP over a socket, real recorded
 * Grants.gov payloads, real libSQL. The announcements are the ones the live feed returned, so
 * the screening decisions asserted here are decisions about real federal opportunities.
 */
const PORT = 3211;

let database: FreshDatabase;
let server: Server;

const organization = unwrapOrThrow(
  Organization.parse({
    id: 'org_1',
    name: 'Cape Fear Literacy Council',
    ein: '581613254',
    city: 'Wilmington',
    state: 'NC',
    nteeCode: 'B60',
    annualRevenueDollars: 656_000,
  }),
);

const sweep = () =>
  new SweepFederalOpportunities(
    new GrantsGovOpportunityGateway({
      baseUrl: `http://127.0.0.1:${PORT}`,
      timeoutMs: 5_000,
      retries: 0,
    }),
    new LibsqlOpportunityRepository(database.db),
    systemClock,
    uuidIdGenerator('sweep'),
  );

beforeAll(async () => {
  database = await freshDatabase();
  server = await startGrantsGovFixtureServer(PORT);

  // The organisation's registry row, so the 501(c)(3) check has the registry's own answer.
  await database.db.execute({
    sql: `INSERT INTO entities (ein, canonical_name, normalized_name, state, subsection)
          VALUES (?, ?, ?, ?, ?)`,
    args: ['581613254', 'CAPE FEAR LITERACY COUNCIL', 'cape fear literacy council', 'NC', 3],
  });
});

afterAll(async () => {
  await stopServer(server);
  await database.destroy();
});

describe('the federal sweep, against real recorded announcements', () => {
  it('stores every announcement the searches returned, with its program number', async () => {
    const result = await sweep().execute({ keywords: SWEEP_KEYWORDS, perKeyword: 10 });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.opportunitiesInserted : 0).toBeGreaterThan(10);
    expect(result.ok ? result.value.parseFaults : -1).toBe(0);

    const stored = await new LibsqlOpportunityRepository(database.db).listOpportunities(100);
    const delta = stored.ok ? stored.value.find((row) => row.number === 'HRSA-26-045') : undefined;

    expect(delta?.programNumbers).toEqual(['93.619']);
    expect(delta?.eligibilityText).toContain('Mississippi Delta Region States');
  });

  it('sweeping again inserts nothing and updates what is already there', async () => {
    const again = await sweep().execute({ keywords: SWEEP_KEYWORDS, perKeyword: 10 });

    expect(again.ok ? again.value.opportunitiesInserted : -1).toBe(0);
    expect(again.ok ? again.value.opportunitiesUpdated : 0).toBeGreaterThan(10);
  });

  it('screens the real announcements and asks a model about none it must not', async () => {
    const model = StubModelGateway.answering({
      fitScore: 68,
      rationale: 'The announcement funds services this organisation already delivers.',
      matchedProgramAreas: ['Education'],
      gaps: ['No evaluation partner is named in the profile.'],
    });

    const screened = await new ScreenFederalOpportunities(
      new LibsqlOpportunityRepository(database.db),
      new LibsqlRegistryStatusReader(database.db),
      model,
      systemClock,
    ).execute({ organization, limit: 100 });

    expect(screened.ok).toBe(true);
    const rows = screened.ok ? screened.value.rows : [];

    const stateGovernmentsOnly = rows.find((row) => row.opportunity.number === 'PAR-25-003');
    expect(stateGovernmentsOnly?.screening.outcome).toBe('ineligible');
    expect(stateGovernmentsOnly?.fitState).toBe('not_applicable');
    expect(stateGovernmentsOnly?.screening.rejections[0]?.reason).toContain('State governments');

    const deltaStates = rows.find((row) => row.opportunity.number === 'HRSA-26-045');
    expect(deltaStates?.screening.rejections.map((check) => check.rule)).toContain('geography');
    expect(deltaStates?.screening.rejections.find((check) => check.rule === 'geography')?.reason).toContain(
      'North Carolina',
    );

    // The cascade, proved against real data: not one prompt names an announcement this
    // organisation cannot apply for.
    const ineligible = rows.filter((row) => row.screening.outcome === 'ineligible');
    expect(ineligible.length).toBeGreaterThan(0);
    for (const row of ineligible) {
      expect(model.requests.some((request) => request.prompt.includes(row.opportunity.number))).toBe(false);
    }

    // Screening must actually be discriminating: some of the real set survives and is scored,
    // or the rule is rejecting everything and proving nothing.
    const scored = rows.filter((row) => row.fitState === 'scored');
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0]?.fit?.matchedProgramAreas).toEqual(['Education']);
    expect(scored[0]?.fit?.gaps.length).toBeGreaterThan(0);
  });

  it('persists the screening reasons so the board can be rendered without re-screening', async () => {
    const board = await new LibsqlOpportunityRepository(database.db).loadBoard('org_1', 100);
    const stored = board.ok
      ? board.value.find((row) => row.opportunity.number === 'PAR-25-003')?.assessment
      : undefined;

    expect(stored?.screening.rejections[0]?.reason).toContain('State governments');
    expect(stored?.fitState).toBe('not_applicable');
  });

  it('never re-buys a score it already has, and works through the queue instead', async () => {
    const board = await new LibsqlOpportunityRepository(database.db).loadBoard('org_1', 100);
    const alreadyScored = board.ok
      ? board.value
          .filter((row) => row.assessment?.fitState === 'scored')
          .map((row) => row.opportunity.number)
      : [];
    expect(alreadyScored.length).toBeGreaterThan(0);

    const model = StubModelGateway.answering({
      fitScore: 55,
      rationale: 'A second pass over the queue.',
      matchedProgramAreas: [],
      gaps: [],
    });
    const screened = await new ScreenFederalOpportunities(
      new LibsqlOpportunityRepository(database.db),
      new LibsqlRegistryStatusReader(database.db),
      model,
      systemClock,
    ).execute({ organization, limit: 100 });

    // Nothing already scored was asked about again: the persisted answer is served.
    for (const number of alreadyScored) {
      expect(model.requests.some((request) => request.prompt.includes(number))).toBe(false);
    }
    // And the queue moved: the pass spent its budget on announcements without a score.
    expect(screened.ok ? screened.value.coverage.scored : 0).toBeGreaterThan(alreadyScored.length);
  });
});
