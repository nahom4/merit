import { andThen, err, map, ParseError, type Result } from '@merit/shared';
import { Ein } from '../shared/ein.js';
import { Cents } from '../shared/money.js';
import { UsState } from '../organization/us-state.js';
import { TaxYear } from './tax-year.js';

/**
 * Which IRS table the record came from. Both matter: parsing only the private foundation
 * table misses Form 990 Schedule I entirely, which is where community foundations and
 * federated funders live -- the most approachable funders for a small nonprofit.
 */
export type SourceForm = '990-PF' | '990-SI';

const SOURCE_FORMS: readonly SourceForm[] = ['990-PF', '990-SI'];

/** One itemised grant: a single edge in the giving graph. */
export interface GrantRecord {
  /** The IRS object id of the filing this came from. Idempotent ingest keys on it. */
  readonly irsObjectId: string;
  readonly funderEin: Ein;
  readonly funderName: string;
  readonly funderState: UsState | null;
  readonly taxYear: TaxYear;
  /** The recipient exactly as filed: free text, unresolved, possibly misspelled. */
  readonly recipientName: string;
  readonly recipientCity: string | null;
  readonly recipientState: UsState | null;
  readonly recipientZip: string | null;
  readonly purpose: string | null;
  readonly amount: Cents;
  readonly sourceForm: SourceForm;
  /** Schedule I filings usually state the recipient's EIN. 990-PF never does. */
  readonly statedRecipientEin: Ein | null;
  /**
   * Position of this row within its table in the filing. Load-bearing: a foundation may list
   * the same recipient twice for the same amount and the same purpose, and those are two
   * grants, not one. Without the position they share a content hash and one of them is lost.
   */
  readonly rowIndex: number;
}

/**
 * The IRS XML carries HTML entities inside text nodes: `Boys &amp; Girls Club`. Left encoded,
 * they break both name normalisation and anything rendered to a screen.
 */
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

export const unescapeXmlText = (value: string): string =>
  value.replace(/&(amp|lt|gt|quot|apos|#39);/g, (match) => ENTITIES[match] ?? match);

const optionalText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = unescapeXmlText(value).trim();
  return trimmed.length === 0 ? null : trimmed;
};

/** Optional US state: a foreign or blank address is absence, not a parse fault. */
const optionalState = (value: unknown): UsState | null => {
  const text = optionalText(value);
  if (text === null) return null;
  const parsed = UsState.parse(text);
  return parsed.ok ? parsed.value : null;
};

/** A stated EIN that will not parse -- all zeros, or letters -- means "not stated". */
const optionalEin = (value: unknown): Ein | null => {
  const text = optionalText(value);
  if (text === null) return null;
  const parsed = Ein.parse(text);
  return parsed.ok ? parsed.value : null;
};

const parse = (value: unknown): Result<GrantRecord, ParseError> => {
  if (typeof value !== 'object' || value === null) {
    return err(new ParseError('grant record must be an object', { field: 'grantRecord' }));
  }
  const raw = value as Record<string, unknown>;

  const irsObjectId = optionalText(raw['irsObjectId']);
  if (irsObjectId === null) {
    return err(new ParseError('grant record must carry its filing object id', { field: 'irsObjectId' }));
  }

  const recipientName = optionalText(raw['recipientName']);
  if (recipientName === null) {
    return err(new ParseError('grant record must name a recipient', { field: 'recipientName' }));
  }

  const sourceForm = raw['sourceForm'];
  if (typeof sourceForm !== 'string' || !SOURCES.has(sourceForm)) {
    return err(
      new ParseError('grant record source form is not one we extract', {
        field: 'sourceForm',
        received: String(sourceForm),
      }),
    );
  }

  return andThen(Ein.parse(raw['funderEin']), (funderEin) =>
    andThen(TaxYear.parse(raw['taxYear']), (taxYear) =>
      map(Cents.fromDollars(raw['amountDollars'] as number), (amount) => ({
        irsObjectId,
        funderEin,
        funderName: optionalText(raw['funderName']) ?? '',
        funderState: optionalState(raw['funderState']),
        taxYear,
        recipientName,
        recipientCity: optionalText(raw['recipientCity']),
        recipientState: optionalState(raw['recipientState']),
        recipientZip: optionalText(raw['recipientZip']),
        purpose: optionalText(raw['purpose']),
        amount,
        sourceForm: sourceForm as SourceForm,
        statedRecipientEin: optionalEin(raw['statedRecipientEin']),
        rowIndex: typeof raw['rowIndex'] === 'number' ? raw['rowIndex'] : 0,
      })),
    ),
  );
};

const SOURCES = new Set<string>(SOURCE_FORMS);

/**
 * What makes re-ingesting a bundle a no-op.
 *
 * Position within the filing is part of the identity, not a tiebreaker: a foundation that
 * paid one grantee twice for the same amount and the same purpose made two grants, and
 * hashing only the content would silently merge them and lose the money. The contents are
 * hashed too, so an amended filing produces new rows rather than quietly overwriting.
 */
const identity = (record: GrantRecord): string =>
  [
    record.irsObjectId,
    record.sourceForm,
    String(record.rowIndex),
    record.funderEin as string,
    record.recipientName.toUpperCase(),
    String(record.amount as number),
    record.purpose ?? '',
  ].join('|');

export const GrantRecord = { parse, identity, SOURCE_FORMS } as const;
