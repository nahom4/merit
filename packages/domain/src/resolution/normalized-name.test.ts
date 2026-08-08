import { describe, expect, it } from 'vitest';
import { blockingKey, normalizeName, soundex, tokensOf } from './normalized-name.js';

describe('normalizeName', () => {
  it('upper-cases', () => {
    expect(normalizeName('Cape Fear Literacy Council')).toBe('CAPE FEAR LITERACY COUNCIL');
  });

  it('strips punctuation', () => {
    expect(normalizeName('Habitat for Humanity, Inc.')).toBe('HABITAT FOR HUMANITY');
  });

  it('drops a possessive, which is a spelling variant rather than a different organisation', () => {
    expect(normalizeName("St. Patrick's Catholic School")).toBe('SAINT PATRICK CATHOLIC SCHOOL');
  });

  it('keeps a plural, which may genuinely distinguish two organisations', () => {
    expect(normalizeName('Boys Home')).toBe('BOYS HOME');
  });

  it('collapses runs of whitespace', () => {
    expect(normalizeName('CAPE   FEAR\tLITERACY')).toBe('CAPE FEAR LITERACY');
  });

  it('drops a leading definite article, which filings use inconsistently', () => {
    expect(normalizeName('The Cannon Foundation')).toBe('CANNON FOUNDATION');
  });

  it('keeps "the" when it is not leading', () => {
    expect(normalizeName('Friends of the Library')).toBe('FRIENDS OF THE LIBRARY');
  });

  it('removes a trailing legal suffix', () => {
    expect(normalizeName('The Cannon Foundation, Inc.')).toBe('CANNON FOUNDATION');
  });

  it('removes several stacked legal suffixes', () => {
    expect(normalizeName('Acme Services Inc Corp')).toBe('ACME SERVICES');
  });

  it('keeps a legal-suffix word that is part of the name itself', () => {
    // Removing every "CO" would turn "CO OP" into "OP" and break the match entirely.
    expect(normalizeName('Incarnation House')).toBe('INCARNATION HOUSE');
  });

  it('expands an ampersand so both spellings agree', () => {
    expect(normalizeName('Boys & Girls Club')).toBe('BOYS AND GIRLS CLUB');
  });

  it('expands common abbreviations from the dictionary', () => {
    expect(normalizeName('Natl Assoc of Univ Ctrs')).toBe('NATIONAL ASSOCIATION OF UNIVERSITY CENTERS');
  });

  it('expands the saint abbreviation, the single most common in the corpus', () => {
    expect(normalizeName('St Marys Hospital')).toBe('SAINT MARYS HOSPITAL');
  });

  it('normalises the two spellings of one organisation to the same string', () => {
    expect(normalizeName('ST PATRICK CATHOLIC SCHOOL')).toBe(normalizeName("St. Patrick's Catholic School"));
  });

  it('returns an empty string for an empty input rather than failing', () => {
    expect(normalizeName('   ')).toBe('');
  });
});

describe('tokensOf', () => {
  it('returns the distinct tokens of a normalised name', () => {
    expect(tokensOf('CAPE FEAR LITERACY COUNCIL')).toEqual(new Set(['CAPE', 'FEAR', 'LITERACY', 'COUNCIL']));
  });

  it('drops stop words that carry no matching signal', () => {
    expect(tokensOf('FRIENDS OF THE LIBRARY')).toEqual(new Set(['FRIENDS', 'LIBRARY']));
  });
});

describe('soundex', () => {
  it('codes a word to a letter and three digits', () => {
    expect(soundex('LITERACY')).toBe('L362');
  });

  it('gives two spellings of one name the same code', () => {
    expect(soundex('SMITH')).toBe(soundex('SMYTH'));
  });

  it('gives different names different codes', () => {
    expect(soundex('LITERACY')).not.toBe(soundex('HOSPITAL'));
  });

  it('pads a short word to four characters', () => {
    expect(soundex('LEE')).toBe('L000');
  });

  it('returns an empty code for an empty word', () => {
    expect(soundex('')).toBe('');
  });
});

describe('blockingKey', () => {
  it('combines the state with the phonetic code of the first significant token', () => {
    expect(blockingKey('CAPE FEAR LITERACY COUNCIL', 'NC')).toBe('NC:C100');
  });

  it('puts two spellings of one organisation in the same block', () => {
    expect(blockingKey(normalizeName('St. Patrick School'), 'NC')).toBe(
      blockingKey(normalizeName('SAINT PATRICK SCHOOL'), 'NC'),
    );
  });

  it('separates organisations in different states, because comparing them is wasted work', () => {
    expect(blockingKey('CAPE FEAR LITERACY COUNCIL', 'NC')).not.toBe(
      blockingKey('CAPE FEAR LITERACY COUNCIL', 'OH'),
    );
  });

  it('returns no key for a name with no significant token, so it is never blocked wrongly', () => {
    expect(blockingKey('OF THE', 'NC')).toBeNull();
  });
});
