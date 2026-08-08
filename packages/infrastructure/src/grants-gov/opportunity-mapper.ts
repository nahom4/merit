import { err, ok, ParseError, type Result } from '@merit/shared';
import type { FederalOpportunity, OpportunityStatus } from '@merit/domain';
import type { GrantsGovOpportunityPayload } from './opportunity.schema.js';

/**
 * Grants.gov's payload into Merit's domain type. The adapter translates; it does not decide.
 *
 * Everything ambiguous fails as a value rather than being guessed at. An unrecognised status,
 * an unparseable date, an award figure that is neither a number nor "none" -- each one means we
 * do not know what the feed is saying, and screening on a guess would produce a rejection
 * nobody could defend.
 */

const MONTHS: Readonly<Record<string, string>> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/**
 * The feed states dates two ways in one payload: `08/24/2026` on a search hit and
 * `Aug 24, 2026 12:00:00 AM EDT` on the detail. Both are normalised to ISO `YYYY-MM-DD` here,
 * by hand: `new Date(string)` is engine- and timezone-dependent, and a deadline that moves by
 * a day depending on where the server runs is a bug that would take a year to notice.
 */
export const parseGrantsGovDate = (value: string | null | undefined): Result<string | null, ParseError> => {
  if (value === null || value === undefined || value.trim().length === 0) return ok(null);
  const text = value.trim();

  const slashes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (slashes !== null) return ok(`${slashes[3]}-${slashes[1]}-${slashes[2]}`);

  const spelled = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  if (spelled !== null) {
    const month = MONTHS[spelled[1]!.toLowerCase()];
    if (month !== undefined) {
      return ok(`${spelled[3]}-${month}-${spelled[2]!.padStart(2, '0')}`);
    }
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso !== null) return ok(`${iso[1]}-${iso[2]}-${iso[3]}`);

  return err(new ParseError('unrecognised Grants.gov date format', { field: 'date', received: text }));
};

/** Whole dollars in, integer cents out. `"none"` is the feed's way of saying "not stated". */
const toCents = (
  value: string | number | null | undefined,
  field: string,
): Result<number | null, ParseError> => {
  if (value === null || value === undefined) return ok(null);
  if (typeof value === 'number') {
    return Number.isFinite(value) ? ok(Math.round(value * 100)) : err(badNumber(field, value));
  }

  const text = value.trim();
  if (text.length === 0 || text.toLowerCase() === 'none') return ok(null);

  const amount = Number(text.replace(/[$,]/g, ''));
  return Number.isFinite(amount) ? ok(Math.round(amount * 100)) : err(badNumber(field, value));
};

const toCount = (
  value: string | number | null | undefined,
  field: string,
): Result<number | null, ParseError> => {
  if (value === null || value === undefined) return ok(null);
  const count = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(count)) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    // "none" and an empty string both mean the announcement did not say.
    return text.length === 0 || text === 'none' ? ok(null) : err(badNumber(field, value));
  }
  return ok(Math.round(count));
};

const badNumber = (field: string, received: unknown): ParseError =>
  new ParseError(`${field} is neither a number nor "none"`, { field, received: String(received) });

const STATUSES: Readonly<Record<string, OpportunityStatus>> = {
  POSTED: 'posted',
  FORECASTED: 'forecasted',
  CLOSED: 'closed',
  ARCHIVED: 'archived',
};

export const toFederalOpportunity = (
  payload: GrantsGovOpportunityPayload,
): Result<FederalOpportunity, ParseError> => {
  const data = payload.data;
  const synopsis = data.synopsis;

  const statusCode = (data.ost ?? '').trim().toUpperCase();
  const status = STATUSES[statusCode];
  if (status === undefined) {
    // A status we do not recognise means we do not know whether this announcement is open.
    // Storing it as "posted" would put a closed opportunity on a board as live work.
    return err(
      new ParseError('unrecognised Grants.gov opportunity status', {
        field: 'ost',
        received: statusCode,
        opportunityId: data.id,
      }),
    );
  }

  const openDate = parseGrantsGovDate(synopsis.postingDate);
  if (!openDate.ok) return openDate;
  const closeDate = parseGrantsGovDate(synopsis.responseDate);
  if (!closeDate.ok) return closeDate;

  const ceiling = toCents(synopsis.awardCeiling, 'awardCeiling');
  if (!ceiling.ok) return ceiling;
  const floor = toCents(synopsis.awardFloor, 'awardFloor');
  if (!floor.ok) return floor;
  const estimated = toCents(synopsis.estimatedFunding, 'estimatedFunding');
  if (!estimated.ok) return estimated;
  const awards = toCount(synopsis.numberOfAwards, 'numberOfAwards');
  if (!awards.ok) return awards;

  const programNumbers = (data.cfdas ?? [])
    .map((cfda) => cfda.cfdaNumber)
    .filter((number): number is string => typeof number === 'string' && number.trim().length > 0);

  return ok({
    id: data.id,
    number: data.opportunityNumber,
    title: data.opportunityTitle,
    agency: synopsis.agencyName ?? 'Agency not stated',
    status,
    openDate: openDate.value,
    closeDate: closeDate.value,
    programNumbers,
    programTitles: (data.cfdas ?? [])
      .map((cfda) => cfda.programTitle)
      .filter((title): title is string => typeof title === 'string' && title.trim().length > 0),
    applicantTypeCodes: (synopsis.applicantTypes ?? []).map((type) => type.id),
    eligibilityText: synopsis.applicantEligibilityDesc ?? null,
    summary: synopsis.synopsisDesc ?? null,
    fundingCategories: (synopsis.fundingActivityCategories ?? []).map((category) => category.description),
    awardCeilingCents: ceiling.value,
    awardFloorCents: floor.value,
    estimatedFundingCents: estimated.value,
    expectedAwardCount: awards.value,
    // Only the full announcement carries the rubric S4 extracts. Supporting documents are not
    // it, and folding them in here would send S4 looking for criteria in a budget template.
    attachments: (data.synopsisAttachmentFolders ?? [])
      .filter((folder) => (folder.folderType ?? '').toLowerCase() === 'full announcement')
      .flatMap((folder) =>
        (folder.synopsisAttachments ?? []).map((attachment) => ({
          id: attachment.id,
          // The feed states both, but not always. An unnamed file is still downloadable, and
          // the extractor sniffs what it got rather than refusing to try.
          fileName: attachment.fileName ?? '',
          mimeType: attachment.mimeType ?? '',
        })),
      ),
  });
};
