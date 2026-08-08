import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@merit/shared';
import { GrantRecord } from './grant-record.js';

const pfGrant = {
  irsObjectId: '202513189349100001',
  funderEin: '561234567',
  funderName: 'THE CANNON FOUNDATION INC',
  funderState: 'NC',
  taxYear: 2024,
  recipientName: 'Cape Fear Literacy Council',
  recipientCity: 'Wilmington',
  recipientState: 'NC',
  recipientZip: '28401',
  purpose: 'ADULT LITERACY PROGRAM SUPPORT',
  amountDollars: 25_000,
  sourceForm: '990-PF',
  statedRecipientEin: null,
};

describe('GrantRecord.parse', () => {
  it('parses a 990-PF Part XV grant', () => {
    const result = GrantRecord.parse(pfGrant);
    expect(isOk(result) && result.value.recipientName).toBe('Cape Fear Literacy Council');
  });

  it('stores the amount as integer cents', () => {
    const result = GrantRecord.parse(pfGrant);
    expect(isOk(result) && result.value.amount).toBe(2_500_000);
  });

  it('keeps the stated recipient EIN when a Schedule I filing supplies one', () => {
    const result = GrantRecord.parse({ ...pfGrant, sourceForm: '990-SI', statedRecipientEin: '58-1613254' });
    expect(isOk(result) && result.value.statedRecipientEin).toBe('581613254');
  });

  it('records a missing recipient EIN as absent rather than guessing', () => {
    const result = GrantRecord.parse(pfGrant);
    expect(isOk(result) && result.value.statedRecipientEin).toBeNull();
  });

  it('treats an all-zero stated EIN as absent, because that is what filings mean by it', () => {
    const result = GrantRecord.parse({ ...pfGrant, statedRecipientEin: '000000000' });
    expect(isOk(result) && result.value.statedRecipientEin).toBeNull();
  });

  it('unescapes the HTML entities the IRS XML carries in name fields', () => {
    const result = GrantRecord.parse({ ...pfGrant, recipientName: 'Boys &amp; Girls Club' });
    expect(isOk(result) && result.value.recipientName).toBe('Boys & Girls Club');
  });

  it('accepts a foreign grant with no US state', () => {
    const result = GrantRecord.parse({ ...pfGrant, recipientState: null, recipientCountry: 'CA' });
    expect(isOk(result) && result.value.recipientState).toBeNull();
  });

  it('accepts a missing purpose, which many filings omit', () => {
    const result = GrantRecord.parse({ ...pfGrant, purpose: null });
    expect(isOk(result) && result.value.purpose).toBeNull();
  });

  it('rejects a record with no funder EIN, since the graph edge would have no source', () => {
    const result = GrantRecord.parse({ ...pfGrant, funderEin: null });
    expect(isErr(result) && result.error.context['field']).toBe('ein');
  });

  it('rejects a record with no recipient name, since the edge would have no target', () => {
    const result = GrantRecord.parse({ ...pfGrant, recipientName: '  ' });
    expect(isErr(result) && result.error.context['field']).toBe('recipientName');
  });

  it('rejects a record with no amount rather than defaulting it to zero', () => {
    expect(isErr(GrantRecord.parse({ ...pfGrant, amountDollars: null }))).toBe(true);
  });

  it('rejects an unknown source form rather than silently accepting a new table', () => {
    const result = GrantRecord.parse({ ...pfGrant, sourceForm: '990-EZ' });
    expect(isErr(result) && result.error.context['field']).toBe('sourceForm');
  });

  it('rejects a record with no IRS object id, which idempotent ingest depends on', () => {
    const result = GrantRecord.parse({ ...pfGrant, irsObjectId: '' });
    expect(isErr(result) && result.error.context['field']).toBe('irsObjectId');
  });

  it('rejects a non-object', () => {
    expect(isErr(GrantRecord.parse('a grant'))).toBe(true);
  });
});

describe('GrantRecord identity', () => {
  it('derives a stable key from the filing, the recipient, and the amount', () => {
    const a = GrantRecord.parse(pfGrant);
    const b = GrantRecord.parse(pfGrant);
    expect(isOk(a) && isOk(b) && GrantRecord.identity(a.value) === GrantRecord.identity(b.value)).toBe(true);
  });

  it('separates two grants from one filing to the same recipient for different amounts', () => {
    const a = GrantRecord.parse(pfGrant);
    const b = GrantRecord.parse({ ...pfGrant, amountDollars: 10_000 });
    expect(isOk(a) && isOk(b) && GrantRecord.identity(a.value) === GrantRecord.identity(b.value)).toBe(false);
  });

  it('separates two grants from one filing to the same recipient for different purposes', () => {
    const a = GrantRecord.parse(pfGrant);
    const b = GrantRecord.parse({ ...pfGrant, purpose: 'GENERAL OPERATING SUPPORT' });
    expect(isOk(a) && isOk(b) && GrantRecord.identity(a.value) === GrantRecord.identity(b.value)).toBe(false);
  });

  it('separates two identical rows in one filing, because they are two grants', () => {
    // A foundation that paid the same grantee $25,000 twice for the same purpose made two
    // grants. Hashing only the contents would merge them and lose $25,000.
    const a = GrantRecord.parse({ ...pfGrant, rowIndex: 0 });
    const b = GrantRecord.parse({ ...pfGrant, rowIndex: 1 });
    expect(isOk(a) && isOk(b) && GrantRecord.identity(a.value) === GrantRecord.identity(b.value)).toBe(false);
  });

  it('gives a row the same identity when the same filing is ingested again', () => {
    const a = GrantRecord.parse({ ...pfGrant, rowIndex: 7 });
    const b = GrantRecord.parse({ ...pfGrant, rowIndex: 7 });
    expect(isOk(a) && isOk(b) && GrantRecord.identity(a.value) === GrantRecord.identity(b.value)).toBe(true);
  });
});
