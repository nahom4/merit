import { XMLParser } from 'fast-xml-parser';
import { UnknownSchemaVersion } from '@merit/shared';
import { text } from './xml-text.js';
import { extractPartXvGrants } from './990-pf.extractor.js';
import { extractScheduleIGrants } from './schedule-i.extractor.js';
import type { ExtractedFiling, RawFiling } from './extracted-filing.js';

/**
 * Return types the IRS publishes in the TEOS bundles. 990 and 990-PF carry itemised grants;
 * 990-EZ and 990-T do not, and that absence is known rather than assumed.
 *
 * Anything outside this set raises. A new return type could carry a grant table we are not
 * reading, and losing data quietly is the worst failure mode this system has.
 */
const KNOWN_RETURN_TYPES = new Set(['990', '990PF', '990EZ', '990T']);

/**
 * Schema years whose element names we have verified. The IRS renames elements between major
 * schema versions, so an unverified year raises rather than extracting zero grants and
 * reporting success -- the exact failure that made an earlier validation run report 0 grants
 * for entire bundles.
 */
const SUPPORTED_SCHEMA_YEARS = new Set([
  '2013',
  '2014',
  '2015',
  '2016',
  '2017',
  '2018',
  '2019',
  '2020',
  '2021',
  '2022',
  '2023',
  '2024',
  '2025',
  '2026',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // A minority of filings are namespace-prefixed (`irs:Return` rather than `Return`) with
  // otherwise identical structure. Without this they parse to an empty document, which the
  // root check below then correctly refuses -- halting a whole bundle over a prefix.
  removeNSPrefix: true,
  // Every text node stays a string: an EIN with a leading zero must not become a number,
  // and an amount is parsed by the domain, not by the XML library.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) =>
    ['GrantOrContributionPdDurYrGrp', 'RecipientTable', 'GrantsOtherAsstToIndivInUSGrp'].includes(name),
});

const RETURN_VERSION = /returnVersion="([^"]*)"/;

/**
 * Parses one filing document into typed grant records.
 *
 * Throws `UnknownSchemaVersion` -- it does not return a Result -- because an unseen structure
 * is not a runtime condition to route around. It is a signal that the corpus changed and the
 * extractor needs a human.
 */
export const parseFiling = (xml: string, irsObjectId: string): ExtractedFiling => {
  const version = RETURN_VERSION.exec(xml)?.[1];
  if (version === undefined || !/^\d{4}v\d+\.\d+$/.test(version)) {
    throw new UnknownSchemaVersion('filing carries no recognisable schema version', {
      irsObjectId,
      returnVersion: version ?? 'absent',
    });
  }
  if (!SUPPORTED_SCHEMA_YEARS.has(version.slice(0, 4))) {
    throw new UnknownSchemaVersion(
      'filing uses a schema version this extractor has not been verified against',
      {
        irsObjectId,
        returnVersion: version,
      },
    );
  }

  const document = parser.parse(xml) as { Return?: RawFiling };
  const filing = document.Return;
  if (filing === undefined) {
    throw new UnknownSchemaVersion('filing has no Return element', { irsObjectId, returnVersion: version });
  }

  const header = filing.ReturnHeader ?? {};
  const returnType = text(header.ReturnTypeCd) ?? '';
  if (!KNOWN_RETURN_TYPES.has(returnType)) {
    throw new UnknownSchemaVersion('filing has a return type this extractor does not recognise', {
      irsObjectId,
      returnVersion: version,
      returnType,
    });
  }

  const filer = header.Filer ?? {};
  const context = {
    irsObjectId,
    filerEin: text(filer.EIN) ?? '',
    filerName: text(filer.BusinessName?.BusinessNameLine1Txt) ?? '',
    filerState: text(filer.USAddress?.StateAbbreviationCd) ?? null,
    taxYear: text(header.TaxYr) ?? '',
  };

  const extracted =
    returnType === '990PF'
      ? extractPartXvGrants(filing, context)
      : returnType === '990'
        ? extractScheduleIGrants(filing, context)
        : { grants: [], parseFaults: 0, statedTotalCents: null, grantsToIndividualsCents: 0 };

  return {
    irsObjectId,
    returnType,
    returnVersion: version,
    taxYear: Number(context.taxYear),
    filerEin: context.filerEin,
    filerName: context.filerName,
    filerState: context.filerState,
    ...extracted,
  };
};
