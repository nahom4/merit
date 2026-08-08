import { describe, expect, it } from 'vitest';
import { computeProspectScore, COMPONENT_WEIGHTS, type ProspectInput } from './prospect-score.js';

const base: ProspectInput = {
  signals: {
    turnover: 0.5,
    newGranteesPerYear: 5,
    newGranteeShare: 0.5,
    concentration: 0.2,
    askP50: 2_500_000,
    askP90: 5_000_000,
    firstTimeAskP50: 1_500_000,
    retentionYearsP50: 2,
    stateShares: { NC: 0.6, SC: 0.2, CA: 0.2 },
    distinctGrantees: 20,
    totalGrants: 40,
    yearsCovered: [2023, 2024],
  },
  peerGranteeCount: 3,
  regionalGranteeCount: 5,
  sameProgramGranteeShare: 0.4,
  organizationState: 'NC',
  organizationRegion: new Set(['NC', 'SC', 'VA', 'TN', 'GA']),
  organizationRevenueCents: 65_573_800,
  materialityFloorCents: 327_869,
};

describe('openness', () => {
  it('is high for a funder that replaces most of its grantees each year', () => {
    const score = computeProspectScore({
      ...base,
      signals: { ...base.signals, turnover: 0.9, newGranteeShare: 0.9 },
    });
    expect(score.openness).toBeGreaterThan(0.8);
  });

  it('is higher for a funder that drops grantees than for one that only adds them', () => {
    // Adding newcomers on top of a kept list is good news; a seat actually coming free is
    // better news for an organisation that is not on the list yet.
    const addsOnly = computeProspectScore({
      ...base,
      signals: { ...base.signals, turnover: 0, newGranteeShare: 0.9 },
    });
    const churns = computeProspectScore({
      ...base,
      signals: { ...base.signals, turnover: 0.9, newGranteeShare: 0.9 },
    });
    expect(churns.openness!).toBeGreaterThan(addsOnly.openness!);
  });

  it('is near zero for a funder that has funded the same list every year', () => {
    const score = computeProspectScore({
      ...base,
      signals: { ...base.signals, turnover: 0, newGranteeShare: 0, newGranteesPerYear: 0 },
    });
    expect(score.openness).toBeLessThan(0.15);
  });

  it('is penalised when one grantee dominates the whole budget', () => {
    const spread = computeProspectScore({ ...base, signals: { ...base.signals, concentration: 0.1 } });
    const dominated = computeProspectScore({ ...base, signals: { ...base.signals, concentration: 0.95 } });
    expect(dominated.openness!).toBeLessThan(spread.openness!);
  });

  it('is reported as unknown rather than as zero when only one year is on file', () => {
    const score = computeProspectScore({
      ...base,
      signals: { ...base.signals, turnover: null, newGranteeShare: null, yearsCovered: [2024] },
    });
    expect(score.openness).toBeNull();
  });
});

describe('affinity', () => {
  it('is high when many of the funder’s grantees are peers of this organisation', () => {
    const score = computeProspectScore({ ...base, peerGranteeCount: 12, sameProgramGranteeShare: 0.8 });
    expect(score.affinity).toBeGreaterThan(0.7);
  });

  it('is low when the funder has never funded anything in this program area', () => {
    const score = computeProspectScore({ ...base, peerGranteeCount: 0, sameProgramGranteeShare: 0 });
    expect(score.affinity).toBe(0);
  });

  it('rises with each additional peer grantee, up to a point', () => {
    const one = computeProspectScore({ ...base, peerGranteeCount: 1 });
    const four = computeProspectScore({ ...base, peerGranteeCount: 4 });
    expect(four.affinity!).toBeGreaterThan(one.affinity!);
  });
});

describe('geographyFit', () => {
  it('is highest for a funder that gives mostly in the organisation’s own state', () => {
    const score = computeProspectScore({
      ...base,
      signals: { ...base.signals, stateShares: { NC: 1 } },
    });
    expect(score.geographyFit).toBe(1);
  });

  it('credits a neighbouring state, but less than the home state', () => {
    const home = computeProspectScore({ ...base, signals: { ...base.signals, stateShares: { NC: 1 } } });
    const neighbour = computeProspectScore({
      ...base,
      signals: { ...base.signals, stateShares: { SC: 1 } },
    });
    expect(neighbour.geographyFit!).toBeLessThan(home.geographyFit!);
    expect(neighbour.geographyFit!).toBeGreaterThan(0);
  });

  it('is near zero for a funder that has never given anywhere near this organisation', () => {
    const score = computeProspectScore({
      ...base,
      signals: { ...base.signals, stateShares: { CA: 0.5, WA: 0.5 } },
    });
    expect(score.geographyFit).toBe(0);
  });
});

describe('sizeFit', () => {
  it('is highest when the typical first grant is comfortably above the materiality floor', () => {
    const score = computeProspectScore({ ...base, signals: { ...base.signals, firstTimeAskP50: 1_500_000 } });
    expect(score.sizeFit!).toBeGreaterThan(0.8);
  });

  it('is zero when the typical grant falls below the materiality floor', () => {
    const score = computeProspectScore({
      ...base,
      signals: { ...base.signals, askP50: 100_000, firstTimeAskP50: 100_000 },
    });
    expect(score.sizeFit).toBe(0);
  });

  it('falls away for a funder whose grants dwarf the organisation’s whole budget', () => {
    // A $5M median grant to a $656k organisation is not a realistic first ask.
    const score = computeProspectScore({
      ...base,
      signals: { ...base.signals, askP50: 500_000_000, firstTimeAskP50: 500_000_000 },
    });
    expect(score.sizeFit).toBeLessThan(0.3);
  });
});

describe('the composite', () => {
  it('is a weighted sum of the four components and nothing else', () => {
    const score = computeProspectScore(base);
    const expected =
      COMPONENT_WEIGHTS.openness * score.openness! +
      COMPONENT_WEIGHTS.affinity * score.affinity! +
      COMPONENT_WEIGHTS.geographyFit * score.geographyFit! +
      COMPONENT_WEIGHTS.sizeFit * score.sizeFit!;
    expect(score.total).toBeCloseTo(expected, 10);
  });

  it('weights openness most heavily, because it is the best proxy for reachability', () => {
    const weights = Object.values(COMPONENT_WEIGHTS);
    expect(COMPONENT_WEIGHTS.openness).toBe(Math.max(...weights));
  });

  it('has weights summing to one, so the composite stays in range', () => {
    const sum = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('redistributes the weight of an unknown component rather than scoring it zero', () => {
    const known = computeProspectScore(base);
    const unknownOpenness = computeProspectScore({
      ...base,
      signals: { ...base.signals, turnover: null, newGranteeShare: null, yearsCovered: [2024] },
    });
    expect(unknownOpenness.openness).toBeNull();
    expect(unknownOpenness.total).toBeGreaterThan(0);
    expect(unknownOpenness.total).not.toBe(known.total);
  });

  it('keeps every component available separately, never only the total', () => {
    const score = computeProspectScore(base);
    expect(Object.keys(score)).toEqual(
      expect.arrayContaining(['openness', 'affinity', 'geographyFit', 'sizeFit', 'total']),
    );
  });
});

describe('credibility', () => {
  it('accepts a funder that has given to two or more peer organisations', () => {
    const score = computeProspectScore({ ...base, peerGranteeCount: 2, regionalGranteeCount: 0 });
    expect(score.isCredible).toBe(true);
  });

  it('accepts a funder that has given to one organisation in region', () => {
    const score = computeProspectScore({ ...base, peerGranteeCount: 1, regionalGranteeCount: 1 });
    expect(score.isCredible).toBe(true);
  });

  it('rejects a funder with a single distant peer grantee', () => {
    const score = computeProspectScore({ ...base, peerGranteeCount: 1, regionalGranteeCount: 0 });
    expect(score.isCredible).toBe(false);
  });

  it('rejects a funder whose median grant is below the materiality floor', () => {
    const score = computeProspectScore({ ...base, signals: { ...base.signals, askP50: 100_000 } });
    expect(score.isCredible).toBe(false);
  });

  it('rejects a funder whose median grant is above the ceiling for a small organisation', () => {
    const score = computeProspectScore({ ...base, signals: { ...base.signals, askP50: 60_000_000_00 } });
    expect(score.isCredible).toBe(false);
  });

  it('states why it rejected a funder rather than silently dropping it', () => {
    const score = computeProspectScore({ ...base, signals: { ...base.signals, askP50: 100_000 } });
    expect(score.credibilityReason).toBe('below_materiality_floor');
  });
});
