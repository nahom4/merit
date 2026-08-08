import { normalizeName, tokensOf } from './normalized-name.js';

/** One side of a comparison: either a filing's free text or a registry row. */
export interface LinkCandidate {
  readonly name: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
}

/**
 * A score with its parts visible. A single number would make every review-queue decision
 * unexplainable, and the thresholds in `LinkDecision` are fitted against these parts.
 */
export interface LinkScore {
  readonly tokenSet: number;
  readonly stringDistance: number;
  readonly addressAgreement: number;
  readonly total: number;
}

/** Jaccard over the significant tokens. Order-insensitive, which filings are too. */
export const tokenSetSimilarity = (left: string, right: string): number => {
  const a = tokensOf(left);
  const b = tokensOf(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
};

const jaro = (a: string, b: string): number => {
  if (a === b) return 1;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const from = Math.max(0, i - window);
    const to = Math.min(i + window + 1, b.length);
    for (let j = from; j < to; j += 1) {
      if (bMatched[j] === true || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (aMatched[i] !== true) continue;
    while (bMatched[k] !== true) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }

  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
};

/**
 * Jaro-Winkler: Jaro with a bonus for a shared prefix. The prefix bonus is what we want here
 * -- organisation names agree at the front and diverge at the end ("... COUNCIL", "... INC").
 */
export const jaroWinkler = (left: string, right: string): number => {
  if (left.length === 0 || right.length === 0) return 0;
  const base = jaro(left, right);
  if (base === 0) return 0;

  let prefix = 0;
  while (prefix < 4 && prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1;
  }
  return base + prefix * 0.1 * (1 - base);
};

/**
 * Address agreement in [0, 1]. An unstated address is 0.5, not 0: 990-PF records frequently
 * omit the city, and treating silence as disagreement would reject correct links.
 */
const addressAgreementOf = (filing: LinkCandidate, registry: LinkCandidate): number => {
  const parts: number[] = [];

  if (filing.state !== null && registry.state !== null) {
    parts.push(filing.state.toUpperCase() === registry.state.toUpperCase() ? 1 : 0);
  }
  if (filing.city !== null && registry.city !== null) {
    parts.push(normalizeName(filing.city) === normalizeName(registry.city) ? 1 : 0);
  }
  if (filing.zip !== null && registry.zip !== null) {
    // Compare the five-digit prefix: filings carry ZIP+4 inconsistently.
    parts.push(filing.zip.slice(0, 5) === registry.zip.slice(0, 5) ? 1 : 0);
  }

  if (parts.length === 0) return 0.5;
  return parts.reduce((sum, part) => sum + part, 0) / parts.length;
};

/**
 * Weights: the name carries the decision, the address adjudicates between organisations whose
 * names genuinely resemble each other. Address alone must never carry a link -- half the
 * charities in a small city share a ZIP code.
 */
const WEIGHT_TOKEN_SET = 0.5;
const WEIGHT_STRING_DISTANCE = 0.3;
const WEIGHT_ADDRESS = 0.2;

export const scoreCandidate = (filing: LinkCandidate, registry: LinkCandidate): LinkScore => {
  const filingName = normalizeName(filing.name);
  const registryName = normalizeName(registry.name);

  const tokenSet = tokenSetSimilarity(filingName, registryName);
  const stringDistance = jaroWinkler(filingName, registryName);
  const addressAgreement = addressAgreementOf(filing, registry);

  return {
    tokenSet,
    stringDistance,
    addressAgreement,
    total:
      WEIGHT_TOKEN_SET * tokenSet +
      WEIGHT_STRING_DISTANCE * stringDistance +
      WEIGHT_ADDRESS * addressAgreement,
  };
};
