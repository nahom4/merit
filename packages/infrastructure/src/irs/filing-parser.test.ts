import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UnknownSchemaVersion } from '@merit/shared';
import { parseFiling } from './filing-parser.js';

/**
 * Fixtures are real filings, trimmed from an actual 2025 IRS bundle. Hand-written XML would
 * test the schema we imagined rather than the one the IRS files (docs/testing.md).
 */
const FIXTURES = join(process.cwd(), 'tests/fixtures/filings');

const fixture = (prefix: string): { xml: string; objectId: string } => {
  const name = readdirSync(FIXTURES).find((file) => file.startsWith(prefix));
  if (name === undefined) throw new Error(`no fixture starting with ${prefix}`);
  return {
    xml: readFileSync(join(FIXTURES, name), 'utf8'),
    objectId: name.replace(`${prefix}-`, '').replace('_public.xml', ''),
  };
};

const parseFixture = (prefix: string) => {
  const { xml, objectId } = fixture(prefix);
  return parseFiling(xml, objectId);
};

describe('parseFiling — 990-PF Part XV', () => {
  it('reads the filer from the return header', () => {
    const filing = parseFixture('pf-multi');
    expect(filing.filerEin).toBe('391890044');
  });

  it('reads the tax year, which is not the year the filing was submitted', () => {
    expect(parseFixture('pf-multi').taxYear).toBe(2023);
  });

  it('reports the return type it dispatched on', () => {
    expect(parseFixture('pf-multi').returnType).toBe('990PF');
  });

  it('extracts every itemised grant in the supplementary information table', () => {
    expect(parseFixture('pf-multi').grants).toHaveLength(30);
  });

  it('labels every grant with the table it came from', () => {
    const filing = parseFixture('pf-multi');
    expect(filing.grants.every((grant) => grant.sourceForm === '990-PF')).toBe(true);
  });

  it('carries the recipient name, address, purpose, and amount through', () => {
    const [first] = parseFixture('pf-multi').grants;
    expect(first?.recipientName.length).toBeGreaterThan(0);
    expect(first?.amount).toBeGreaterThan(0);
    expect(first?.recipientState).not.toBeUndefined();
  });

  it('records no stated recipient EIN, because 990-PF never carries one', () => {
    const filing = parseFixture('pf-multi');
    expect(filing.grants.every((grant) => grant.statedRecipientEin === null)).toBe(true);
  });

  it('reads the stated total, which the reconciliation check compares against', () => {
    expect(parseFixture('pf-multi').statedTotalCents).toBe(270_145_00);
  });

  it('returns no grants for a foundation that itemised none', () => {
    expect(parseFixture('no-grants').grants).toHaveLength(0);
  });

  it('still reads the filer of a filing with no grants', () => {
    expect(parseFixture('no-grants').filerEin).toBe('542118821');
  });
});

describe('parseFiling — 990 Schedule I', () => {
  it('extracts the recipient table', () => {
    expect(parseFixture('schedule-i').grants).toHaveLength(13);
  });

  it('labels the grants as Schedule I, not as private foundation grants', () => {
    const filing = parseFixture('schedule-i');
    expect(filing.grants.every((grant) => grant.sourceForm === '990-SI')).toBe(true);
  });

  it('keeps the recipient EIN Schedule I states, which 990-PF cannot supply', () => {
    const filing = parseFixture('schedule-i');
    expect(filing.grants[0]?.statedRecipientEin).toBe('650385507');
  });

  it('reads the recipient name and amount', () => {
    const filing = parseFixture('schedule-i');
    expect(filing.grants[0]?.recipientName).toBe('FLORIDA ATLANTIC UNIVERSITY');
    expect(filing.grants[0]?.amount).toBe(10_000_00);
  });

  it('reads the grantee address', () => {
    const filing = parseFixture('schedule-i');
    expect(filing.grants[0]?.recipientState).toBe('FL');
    expect(filing.grants[0]?.recipientCity).toBe('BOCA RATON');
  });
});

describe('parseFiling — Schedule I grants to individuals', () => {
  it('extracts the organisation table as graph edges', () => {
    expect(parseFixture('schedule-i-individuals').grants).toHaveLength(2);
  });

  it('counts grants to individuals separately rather than dropping them', () => {
    // Part III has no named recipient organisation, so it is not a graph edge -- but the
    // money is real and the reconciliation check needs it.
    expect(parseFixture('schedule-i-individuals').grantsToIndividualsCents).toBe(765_298_00);
  });

  it('never invents a recipient organisation for a grant made to individuals', () => {
    const filing = parseFixture('schedule-i-individuals');
    expect(filing.grants.every((grant) => grant.recipientName.trim().length > 0)).toBe(true);
  });
});

describe('parseFiling — unknown structure', () => {
  it('raises on a schema version it has never seen rather than silently extracting nothing', () => {
    const { xml, objectId } = fixture('pf-multi');
    const future = xml.replace('returnVersion="2023v5.1"', 'returnVersion="2099v9.9"');
    expect(() => parseFiling(future, objectId)).toThrow(UnknownSchemaVersion);
  });

  it('names the version and the filing in the error, so the fix is obvious', () => {
    const { xml, objectId } = fixture('pf-multi');
    const future = xml.replace('returnVersion="2023v5.1"', 'returnVersion="2099v9.9"');
    try {
      parseFiling(future, objectId);
      expect.unreachable('should have raised');
    } catch (error) {
      expect((error as UnknownSchemaVersion).context['returnVersion']).toBe('2099v9.9');
      expect((error as UnknownSchemaVersion).context['irsObjectId']).toBe(objectId);
    }
  });

  it('raises on a filing with no schema version at all', () => {
    const { xml, objectId } = fixture('pf-multi');
    expect(() => parseFiling(xml.replace(' returnVersion="2023v5.1"', ''), objectId)).toThrow(
      UnknownSchemaVersion,
    );
  });

  it('raises on an unrecognised return type rather than assuming it has no grants', () => {
    const { xml, objectId } = fixture('pf-multi');
    const odd = xml.replace('<ReturnTypeCd>990PF</ReturnTypeCd>', '<ReturnTypeCd>990XX</ReturnTypeCd>');
    expect(() => parseFiling(odd, objectId)).toThrow(UnknownSchemaVersion);
  });

  it('accepts a known return type that carries no grant table', () => {
    const { xml, objectId } = fixture('pf-multi');
    const ez = xml.replace('<ReturnTypeCd>990PF</ReturnTypeCd>', '<ReturnTypeCd>990EZ</ReturnTypeCd>');
    expect(parseFiling(ez, objectId).grants).toHaveLength(0);
  });
});

describe('parseFiling — parse faults', () => {
  it('counts a grant row it could not use instead of failing the whole filing', () => {
    const { xml, objectId } = fixture('pf-multi');
    // A row whose amount is not a number: one bad row must not lose the other 29.
    const damaged = xml.replace('<Amt>30000</Amt>', '<Amt>not-a-number</Amt>');
    const filing = parseFiling(damaged, objectId);
    expect(filing.grants.length + filing.parseFaults).toBe(30);
    expect(filing.parseFaults).toBeGreaterThan(0);
  });
});

describe('parseFiling — namespace-prefixed filings', () => {
  it('parses a filing whose elements carry the irs: namespace prefix', () => {
    // A minority of real filings are prefixed. Same schema, same fields, different spelling.
    // Left unhandled this parses to an empty document and halts the bundle it is in.
    const filing = parseFixture('namespaced');
    expect(filing.filerEin).toBe('880542528');
    expect(filing.taxYear).toBe(2022);
    expect(filing.returnType).toBe('990EZ');
  });
});
