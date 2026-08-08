import { describe, expect, it } from 'vitest';
import { jaroWinkler, scoreCandidate, tokenSetSimilarity } from './link-score.js';

describe('tokenSetSimilarity', () => {
  it('is 1 for identical token sets', () => {
    expect(tokenSetSimilarity('CAPE FEAR LITERACY COUNCIL', 'CAPE FEAR LITERACY COUNCIL')).toBe(1);
  });

  it('is 0 when no token is shared', () => {
    expect(tokenSetSimilarity('CAPE FEAR LITERACY', 'MOUNTAIN HEALTH CLINIC')).toBe(0);
  });

  it('ignores token order, which filings vary freely', () => {
    expect(tokenSetSimilarity('LITERACY COUNCIL CAPE FEAR', 'CAPE FEAR LITERACY COUNCIL')).toBe(1);
  });

  it('falls between 0 and 1 for a partial overlap', () => {
    const score = tokenSetSimilarity('CAPE FEAR LITERACY COUNCIL', 'CAPE FEAR LITERACY');
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  it('is 0 when either side has no tokens', () => {
    expect(tokenSetSimilarity('', 'CAPE FEAR')).toBe(0);
  });
});

describe('jaroWinkler', () => {
  it('is 1 for identical strings', () => {
    expect(jaroWinkler('LITERACY', 'LITERACY')).toBe(1);
  });

  it('is 0 for strings with nothing in common', () => {
    expect(jaroWinkler('AAAA', 'BBBB')).toBe(0);
  });

  it('rates a single-character typo highly', () => {
    expect(jaroWinkler('LITERACY', 'LITERACEY')).toBeGreaterThan(0.9);
  });

  it('rewards a shared prefix, because organisation names diverge at the end', () => {
    const sharedPrefix = jaroWinkler('CAPE FEAR LITERACY', 'CAPE FEAR LITERACY COUNCIL');
    const sharedSuffix = jaroWinkler('LITERACY COUNCIL', 'CAPE FEAR LITERACY COUNCIL');
    expect(sharedPrefix).toBeGreaterThan(sharedSuffix);
  });

  it('is 0 when either side is empty', () => {
    expect(jaroWinkler('', 'LITERACY')).toBe(0);
  });
});

const registryRow = {
  name: 'CAPE FEAR LITERACY COUNCIL',
  city: 'WILMINGTON',
  state: 'NC',
  zip: '28401',
};

describe('scoreCandidate', () => {
  it('scores an exact name and address match at the top of the range', () => {
    const score = scoreCandidate(
      { name: 'Cape Fear Literacy Council', city: 'Wilmington', state: 'NC', zip: '28401' },
      registryRow,
    );
    expect(score.total).toBeGreaterThan(0.95);
  });

  it('scores an unrelated organisation in the same block near zero', () => {
    const score = scoreCandidate(
      { name: 'Coastal Horizons Center', city: 'Wilmington', state: 'NC', zip: '28401' },
      registryRow,
    );
    expect(score.total).toBeLessThan(0.5);
  });

  it('reports its parts separately, so a decision can be explained', () => {
    const score = scoreCandidate(
      { name: 'Cape Fear Literacy Council', city: 'Wilmington', state: 'NC', zip: '28401' },
      registryRow,
    );
    expect(score.tokenSet).toBe(1);
    expect(score.addressAgreement).toBe(1);
  });

  it('penalises a name match in a different city', () => {
    const sameCity = scoreCandidate(
      { name: 'Cape Fear Literacy Council', city: 'Wilmington', state: 'NC', zip: '28401' },
      registryRow,
    );
    const otherCity = scoreCandidate(
      { name: 'Cape Fear Literacy Council', city: 'Raleigh', state: 'NC', zip: '27601' },
      registryRow,
    );
    expect(otherCity.total).toBeLessThan(sameCity.total);
  });

  it('still scores a strong name match when the filing gave no address at all', () => {
    const score = scoreCandidate(
      { name: 'Cape Fear Literacy Council', city: null, state: null, zip: null },
      registryRow,
    );
    expect(score.total).toBeGreaterThan(0.7);
  });

  it('does not let address agreement alone carry an unrelated name', () => {
    const score = scoreCandidate(
      { name: 'Wilmington Symphony Orchestra', city: 'Wilmington', state: 'NC', zip: '28401' },
      registryRow,
    );
    expect(score.total).toBeLessThan(0.6);
  });

  it('matches the two spellings the design calls out as one organisation', () => {
    const score = scoreCandidate(
      { name: "St. Patrick's Catholic School", city: 'Wilmington', state: 'NC', zip: '28401' },
      { name: 'ST PATRICK CATHOLIC SCHOOL', city: 'WILMINGTON', state: 'NC', zip: '28401' },
    );
    expect(score.total).toBeGreaterThan(0.95);
  });
});
