import type { FunderSignals } from '../funder/funder-signals.js';

/**
 * The four score components, always separate. A development director has to defend a
 * prospect list to a board, and "the model said so" is not a defence -- so there is no
 * single opaque number here, only a transparent weighted sum of four values that are each
 * traceable to grantee rows.
 */
export interface ProspectInput {
  readonly signals: FunderSignals;
  /** Distinct grantees of this funder that are peers of the organisation. */
  readonly peerGranteeCount: number;
  /** Distinct grantees of this funder inside the organisation's funding region. */
  readonly regionalGranteeCount: number;
  /** Share of the funder's resolved grantees in the organisation's NTEE major group. */
  readonly sameProgramGranteeShare: number;
  readonly organizationState: string;
  readonly organizationRegion: ReadonlySet<string>;
  readonly organizationRevenueCents: number;
  readonly materialityFloorCents: number;
}

export interface ProspectScore {
  /** Would this funder consider a newcomer? Null when there is not enough history to say. */
  readonly openness: number | null;
  /** Does it fund organisations like this one? */
  readonly affinity: number | null;
  /** Does it give anywhere near here? */
  readonly geographyFit: number | null;
  /** Is its typical grant the right size for an organisation this size? */
  readonly sizeFit: number | null;
  /** A transparent weighted sum. Never shown without its four parts. */
  readonly total: number;
  readonly isCredible: boolean;
  readonly credibilityReason: CredibilityReason;
}

export type CredibilityReason =
  'credible' | 'too_few_grantees_in_common' | 'below_materiality_floor' | 'above_size_ceiling';

/**
 * Turnover carries the most weight: it is the closest available proxy for whether a newcomer
 * can get in, and it is not something a funder publishes about itself (Merit.md section 8).
 */
export const COMPONENT_WEIGHTS = {
  openness: 0.35,
  affinity: 0.3,
  geographyFit: 0.2,
  sizeFit: 0.15,
} as const;

/**
 * A funder whose median grant exceeds this is operating at a scale where a small
 * organisation's application is not competitive. Matches the ceiling used in the validation
 * run (validation/analyze.py).
 */
const SIZE_CEILING_CENTS = 500_000_00;

/** Beyond this many peer grantees, more peers do not tell us anything new. */
const PEER_SATURATION = 5;

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

const opennessOf = (signals: FunderSignals): number | null => {
  if (signals.turnover === null || signals.newGranteeShare === null) return null;
  // Turnover says a seat opens up; new-grantee share says a stranger takes it. Concentration
  // discounts both: a foundation whose budget is one grantee has no room regardless.
  const churn = 0.6 * signals.turnover + 0.4 * signals.newGranteeShare;
  const spread = signals.concentration === null ? 1 : 1 - signals.concentration;
  return clamp(churn * (0.6 + 0.4 * spread));
};

const affinityOf = (input: ProspectInput): number | null => {
  const peerSignal = clamp(input.peerGranteeCount / PEER_SATURATION);
  const programSignal = clamp(input.sameProgramGranteeShare);
  // Peers are direct evidence; program share is the wider pattern. Both must be zero for
  // affinity to be zero, and either alone is worth something.
  return clamp(0.6 * peerSignal + 0.4 * programSignal);
};

const geographyFitOf = (input: ProspectInput): number | null => {
  const shares = input.signals.stateShares;
  if (Object.keys(shares).length === 0) return null;

  const home = shares[input.organizationState] ?? 0;
  let neighbouring = 0;
  for (const [state, share] of Object.entries(shares)) {
    if (state !== input.organizationState && input.organizationRegion.has(state)) neighbouring += share;
  }
  // A funder across a state line is a live prospect; one across the country usually is not.
  return clamp(home + 0.6 * neighbouring);
};

const sizeFitOf = (input: ProspectInput): number | null => {
  const typical = input.signals.firstTimeAskP50 ?? input.signals.askP50;
  if (typical === null) return null;
  if (typical < input.materialityFloorCents) return 0;

  // The band a first ask realistically sits in: above the floor, and no larger than the
  // organisation's own annual revenue. A grant bigger than everything the organisation
  // raises in a year goes to somebody else.
  const ceiling = Math.max(input.materialityFloorCents * 4, input.organizationRevenueCents);
  if (typical <= ceiling) return 1;

  // Beyond the ceiling, decay rather than cliff-edge: a somewhat-too-large funder is a worse
  // prospect, not an impossible one.
  return clamp(ceiling / typical);
};

const credibilityOf = (input: ProspectInput): CredibilityReason => {
  const median = input.signals.askP50;
  if (median !== null && median < input.materialityFloorCents) return 'below_materiality_floor';
  if (median !== null && median > SIZE_CEILING_CENTS) return 'above_size_ceiling';
  // The bar from the validation run: two or more peer grantees, or one in region.
  if (input.peerGranteeCount >= 2 || input.regionalGranteeCount >= 1) return 'credible';
  return 'too_few_grantees_in_common';
};

export const computeProspectScore = (input: ProspectInput): ProspectScore => {
  const components = {
    openness: opennessOf(input.signals),
    affinity: affinityOf(input),
    geographyFit: geographyFitOf(input),
    sizeFit: sizeFitOf(input),
  };

  // An unknown component does not score zero -- that would rank a funder with one year of
  // filings below one we know to be closed. Its weight is redistributed across what is known.
  let weighted = 0;
  let weightAvailable = 0;
  for (const [name, value] of Object.entries(components)) {
    const weight = COMPONENT_WEIGHTS[name as keyof typeof COMPONENT_WEIGHTS];
    if (value === null) continue;
    weighted += weight * value;
    weightAvailable += weight;
  }

  const reason = credibilityOf(input);
  return {
    ...components,
    total: weightAvailable === 0 ? 0 : weighted / weightAvailable,
    isCredible: reason === 'credible',
    credibilityReason: reason,
  };
};
