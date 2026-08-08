import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { streamBundle, parseFiling } from '@merit/infrastructure';

/** A real IRS bundle, trimmed to 60 filings. Real bytes, real compression, real schema. */
const BUNDLE = join(process.cwd(), 'tests/fixtures/bundle-sample.zip');

describe('streamBundle', () => {
  it('yields every filing document in the bundle', async () => {
    let count = 0;
    for await (const entry of streamBundle(BUNDLE)) if (entry.irsObjectId.length > 0) count += 1;
    expect(count).toBe(60);
  });

  it('derives the IRS object id from the entry name', async () => {
    for await (const entry of streamBundle(BUNDLE)) {
      expect(entry.irsObjectId).toMatch(/^\d{18}$/);
      break;
    }
  });

  it('yields parseable XML', async () => {
    for await (const entry of streamBundle(BUNDLE)) {
      expect(entry.xml).toContain('<Return');
      break;
    }
  });

  it('holds no more than one document at a time', async () => {
    // Proven by consuming a single entry and stopping: if the generator had buffered the
    // whole bundle, breaking early would still have read all 2.6MB.
    const before = process.memoryUsage().heapUsed;
    for await (const entry of streamBundle(BUNDLE)) {
      expect(entry.xml.length).toBeGreaterThan(0);
      break;
    }
    const grew = process.memoryUsage().heapUsed - before;
    expect(grew).toBeLessThan(5_000_000);
  });

  it('extracts every organisation-to-organisation grant in the bundle', async () => {
    // The fixture holds 271 itemised grant rows. 34 of them name an individual rather than
    // an organisation, so 237 are edges in the giving graph.
    let grants = 0;
    for await (const entry of streamBundle(BUNDLE)) {
      grants += parseFiling(entry.xml, entry.irsObjectId).grants.length;
    }
    expect(grants).toBe(237);
  });

  it('accounts for grants to individuals rather than dropping them from the totals', async () => {
    let individuals = 0;
    for await (const entry of streamBundle(BUNDLE)) {
      individuals += parseFiling(entry.xml, entry.irsObjectId).grantsToIndividualsCents;
    }
    expect(individuals).toBeGreaterThan(0);
  });

  it('reconciles extracted grants against the total each 990-PF states about itself', async () => {
    // A private foundation states its total contributions paid. Summing the itemised rows
    // should approximate it; a material divergence is an extraction fault, measured here
    // rather than assumed away.
    let checked = 0;
    let diverged = 0;
    for await (const entry of streamBundle(BUNDLE)) {
      const filing = parseFiling(entry.xml, entry.irsObjectId);
      if (filing.statedTotalCents === null || filing.statedTotalCents === 0) continue;
      const summed =
        filing.grants.reduce((total, grant) => total + (grant.amount as number), 0) +
        filing.grantsToIndividualsCents;
      checked += 1;
      if (Math.abs(summed - filing.statedTotalCents) / filing.statedTotalCents > 0.01) diverged += 1;
    }
    expect(checked).toBeGreaterThan(10);
    expect(diverged / checked).toBeLessThan(0.1);
  });

  it('reports a parse-fault rate across a real bundle, rather than assuming zero', async () => {
    let faults = 0;
    let grants = 0;
    for await (const entry of streamBundle(BUNDLE)) {
      const filing = parseFiling(entry.xml, entry.irsObjectId);
      faults += filing.parseFaults;
      grants += filing.grants.length;
    }
    expect(faults / (faults + grants)).toBeLessThan(0.01);
  });

  it('fails loudly on a file that is not a zip', async () => {
    const notAZip = join(process.cwd(), 'package.json');
    await expect(async () => {
      for await (const entry of streamBundle(notAZip)) {
        expect(entry).toBeDefined();
        break;
      }
    }).rejects.toThrow();
  });
});
