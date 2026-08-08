import { describe, expect, it } from 'vitest';
import { computeFunderSignals, type GranteeGrant } from './funder-signals.js';

const grant = (granteeKey: string, taxYear: number, amountDollars: number, state = 'NC'): GranteeGrant => ({
  granteeKey,
  taxYear,
  amountCents: amountDollars * 100,
  granteeState: state,
});

describe('computeFunderSignals — turnover', () => {
  it('reports full turnover when no grantee repeats', () => {
    const signals = computeFunderSignals([
      grant('a', 2023, 10_000),
      grant('b', 2023, 10_000),
      grant('c', 2024, 10_000),
      grant('d', 2024, 10_000),
    ]);
    expect(signals.turnover).toBe(1);
  });

  it('reports zero turnover when the same grantees are funded every year', () => {
    const signals = computeFunderSignals([
      grant('a', 2023, 10_000),
      grant('b', 2023, 10_000),
      grant('a', 2024, 10_000),
      grant('b', 2024, 10_000),
    ]);
    expect(signals.turnover).toBe(0);
  });

  it('reports half turnover when half the year is new', () => {
    const signals = computeFunderSignals([
      grant('a', 2023, 10_000),
      grant('b', 2023, 10_000),
      grant('a', 2024, 10_000),
      grant('c', 2024, 10_000),
    ]);
    expect(signals.turnover).toBe(0.5);
  });

  it('reports turnover as unknown for a funder with only one year on file', () => {
    // One year has no prior year to compare against. Reporting 1 would flag every
    // single-filing foundation as wide open, which is the opposite of what is known.
    expect(computeFunderSignals([grant('a', 2024, 10_000)]).turnover).toBeNull();
  });

  it('averages turnover across every year that has a predecessor', () => {
    const signals = computeFunderSignals([
      grant('a', 2022, 10_000),
      grant('a', 2023, 10_000),
      grant('b', 2024, 10_000),
    ]);
    expect(signals.turnover).toBe(0.5);
  });
});

describe('computeFunderSignals — turnover is departures, not arrivals', () => {
  it('is zero when a funder keeps everyone and adds newcomers on top', () => {
    // Nobody left, so no seat came free -- even though the grantee list doubled.
    const signals = computeFunderSignals([
      grant('a', 2023, 10_000),
      grant('a', 2024, 10_000),
      grant('b', 2024, 10_000),
    ]);
    expect(signals.turnover).toBe(0);
    expect(signals.newGranteeShare).toBe(0.5);
  });

  it('is one when a funder drops its entire prior list', () => {
    const signals = computeFunderSignals([grant('a', 2023, 10_000), grant('b', 2024, 10_000)]);
    expect(signals.turnover).toBe(1);
  });
});

describe('computeFunderSignals — new grantees', () => {
  it('counts first-time grantees per year', () => {
    const signals = computeFunderSignals([
      grant('a', 2023, 10_000),
      grant('a', 2024, 10_000),
      grant('b', 2024, 10_000),
      grant('c', 2024, 10_000),
    ]);
    expect(signals.newGranteesPerYear).toBe(2);
  });

  it('reports the share of a year that is new as well as the count', () => {
    const signals = computeFunderSignals([
      grant('a', 2023, 10_000),
      grant('a', 2024, 10_000),
      grant('b', 2024, 10_000),
    ]);
    expect(signals.newGranteeShare).toBe(0.5);
  });
});

describe('computeFunderSignals — concentration', () => {
  it('reports an HHI of 1 when one grantee takes everything', () => {
    expect(computeFunderSignals([grant('a', 2024, 100_000)]).concentration).toBe(1);
  });

  it('reports a low HHI when giving is spread evenly', () => {
    const signals = computeFunderSignals([
      grant('a', 2024, 10_000),
      grant('b', 2024, 10_000),
      grant('c', 2024, 10_000),
      grant('d', 2024, 10_000),
    ]);
    expect(signals.concentration).toBeCloseTo(0.25, 5);
  });

  it('separates one dominant grantee from an even spread', () => {
    const dominant = computeFunderSignals([
      grant('a', 2024, 900_000),
      grant('b', 2024, 10_000),
      grant('c', 2024, 10_000),
    ]);
    const even = computeFunderSignals([
      grant('a', 2024, 10_000),
      grant('b', 2024, 10_000),
      grant('c', 2024, 10_000),
    ]);
    expect(dominant.concentration!).toBeGreaterThan(even.concentration!);
  });
});

describe('computeFunderSignals — ask distribution', () => {
  it('reports the median grant', () => {
    const signals = computeFunderSignals([
      grant('a', 2024, 5_000),
      grant('b', 2024, 10_000),
      grant('c', 2024, 30_000),
    ]);
    expect(signals.askP50).toBe(1_000_000);
  });

  it('averages the two middle values for an even count', () => {
    const signals = computeFunderSignals([grant('a', 2024, 10_000), grant('b', 2024, 20_000)]);
    expect(signals.askP50).toBe(1_500_000);
  });

  it('reports the 90th percentile by nearest rank', () => {
    const grants = Array.from({ length: 10 }, (_, i) => grant(`g${i}`, 2024, (i + 1) * 1_000));
    expect(computeFunderSignals(grants).askP90!).toBe(900_000);
  });

  it('reports the median first grant to a new grantee, which is what sets the ask', () => {
    const signals = computeFunderSignals([
      grant('a', 2023, 5_000),
      grant('a', 2024, 50_000),
      grant('b', 2023, 15_000),
      grant('b', 2024, 60_000),
    ]);
    // First grants were $5,000 and $15,000; the renewals are not what a newcomer gets.
    expect(signals.firstTimeAskP50).toBe(1_000_000);
  });

  it('prefers grantees that genuinely arrived mid-corpus over the left-censored first year', () => {
    const signals = computeFunderSignals([
      grant('a', 2023, 5_000),
      grant('a', 2024, 50_000),
      // 'b' is the only grantee we can be sure was new: it is absent from 2023.
      grant('b', 2024, 20_000),
    ]);
    expect(signals.firstTimeAskP50).toBe(2_000_000);
  });
});

describe('computeFunderSignals — retention and geography', () => {
  it('reports the median number of consecutive years a grantee is kept', () => {
    const signals = computeFunderSignals([
      grant('a', 2022, 10_000),
      grant('a', 2023, 10_000),
      grant('a', 2024, 10_000),
      grant('b', 2024, 10_000),
    ]);
    expect(signals.retentionYearsP50).toBe(2);
  });

  it('reports the share of grants that stayed in one state', () => {
    const signals = computeFunderSignals([
      grant('a', 2024, 10_000, 'NC'),
      grant('b', 2024, 10_000, 'NC'),
      grant('c', 2024, 10_000, 'CA'),
      grant('d', 2024, 10_000, 'NY'),
    ]);
    expect(signals.stateShares['NC']).toBe(0.5);
  });

  it('counts distinct grantees and years covered, so coverage can be stated', () => {
    const signals = computeFunderSignals([
      grant('a', 2023, 10_000),
      grant('a', 2024, 10_000),
      grant('b', 2024, 10_000),
    ]);
    expect(signals.distinctGrantees).toBe(2);
    expect(signals.yearsCovered).toEqual([2023, 2024]);
  });
});

describe('computeFunderSignals — no data', () => {
  it('returns empty signals rather than dividing by zero', () => {
    const signals = computeFunderSignals([]);
    expect(signals.distinctGrantees).toBe(0);
    expect(signals.turnover).toBeNull();
    expect(signals.askP50).toBeNull();
  });
});
