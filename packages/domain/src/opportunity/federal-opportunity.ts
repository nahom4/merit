/** Where an announcement is in its life. Grants.gov states it as `oppStatus`. */
export type OpportunityStatus = 'posted' | 'forecasted' | 'closed' | 'archived';

/**
 * A federal funding announcement, reduced to what Merit decides with.
 *
 * Money is integer cents, as everywhere. Dates are ISO `YYYY-MM-DD`: Grants.gov states them
 * three different ways in one payload (`08/24/2026`, `Aug 24, 2026 12:00:00 AM EST`,
 * `2026-08-24-00-00-00`), and normalising at the boundary keeps that out of the domain.
 *
 * `programNumbers` is the CFDA / Assistance Listing number, and it is the single most valuable
 * field here: it is the join key to federal award history in S5. It must survive ingestion.
 */
export interface FederalOpportunity {
  /** Grants.gov's own opportunity id, and the key deduplication is done on. */
  readonly id: string;
  /** The announcement number a human quotes, e.g. `HHS-2026-ACF-OCS-EAH-0027`. */
  readonly number: string;
  readonly title: string;
  readonly agency: string;
  readonly status: OpportunityStatus;
  readonly openDate: string | null;
  readonly closeDate: string | null;
  readonly programNumbers: readonly string[];
  readonly programTitles: readonly string[];
  /** Grants.gov applicant eligibility codes. See `applicant-type.ts` for what they mean. */
  readonly applicantTypeCodes: readonly string[];
  /** The announcement's own eligibility prose. The only place geography is ever stated. */
  readonly eligibilityText: string | null;
  readonly summary: string | null;
  /** The announcement's funding activity categories, e.g. "Health". Part of the menu the fit
   *  score may choose matched program areas from, so a fabricated area cannot survive parsing. */
  readonly fundingCategories: readonly string[];
  readonly awardCeilingCents: number | null;
  readonly awardFloorCents: number | null;
  readonly estimatedFundingCents: number | null;
  readonly expectedAwardCount: number | null;
  /** Attachments on the full announcement, which S4 downloads the rubric from. */
  readonly attachments: readonly OpportunityAttachment[];
}

/**
 * One file on the full announcement.
 *
 * The media type and the file name are carried rather than the id alone because S4 has to
 * choose which file to read: a "Full Announcement" folder routinely holds the NOFO beside a
 * budget spreadsheet and a webinar flyer, and handing `pdftotext` an `.xlsx` produces silence,
 * not a rubric.
 */
export interface OpportunityAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
}
