import type { GrantRecord } from '@merit/domain';

/** The shape fast-xml-parser produces for a filing. Untyped at the edges by nature -- every
 *  field is read through `text()` and parsed before it becomes a domain value. */
export interface RawFiling {
  readonly ReturnHeader?: {
    readonly ReturnTypeCd?: unknown;
    readonly TaxYr?: unknown;
    readonly Filer?: {
      readonly EIN?: unknown;
      readonly BusinessName?: { readonly BusinessNameLine1Txt?: unknown };
      readonly USAddress?: { readonly StateAbbreviationCd?: unknown };
    };
  };
  readonly ReturnData?: Record<string, unknown>;
}

export interface ExtractionContext {
  readonly irsObjectId: string;
  readonly filerEin: string;
  readonly filerName: string;
  readonly filerState: string | null;
  readonly taxYear: string;
}

export interface ExtractionResult {
  readonly grants: readonly GrantRecord[];
  /** Rows present in the table that could not be turned into a record. Measured, not assumed. */
  readonly parseFaults: number;
  /** The filing's own stated total, where the form has one. Null where it does not. */
  readonly statedTotalCents: number | null;
  /** Grants to individuals: real money, but not an edge between two organisations. */
  readonly grantsToIndividualsCents: number;
}

export interface ExtractedFiling extends ExtractionResult {
  readonly irsObjectId: string;
  readonly returnType: string;
  readonly returnVersion: string;
  readonly taxYear: number;
  readonly filerEin: string;
  readonly filerName: string;
  readonly filerState: string | null;
}
