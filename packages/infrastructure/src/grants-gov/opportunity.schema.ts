import { z } from 'zod';

/**
 * The two Grants.gov payloads Merit parses, as the live API returns them (verified
 * 8 August 2026; `tests/fixtures/grants-gov/` holds real recorded responses and the nightly
 * contract test regenerates them).
 *
 * Everything optional here is optional in the real feed: `awardCeiling` arrives as a number on
 * one announcement and the string `"none"` on the next, `estimatedFunding` is absent entirely
 * on some, and `cfdas` can carry an entry with no number. The schema says so rather than
 * pretending the feed is tidier than it is -- but nothing is coerced past the boundary.
 */

/** A dollar figure the feed states as a number, a numeric string, or the word "none". */
const Dollars = z.union([z.number(), z.string()]).nullish();

const CodedValue = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  description: z.string(),
});

export const GrantsGovSearchResponseSchema = z.object({
  errorcode: z.union([z.number(), z.string()]).transform(Number),
  msg: z.string().optional(),
  data: z.object({
    hitCount: z.number().optional(),
    oppHits: z.array(
      z.object({
        id: z.union([z.string(), z.number()]).transform(String),
        number: z.string(),
        title: z.string(),
        agency: z.string().nullish(),
        agencyCode: z.string().nullish(),
        openDate: z.string().nullish(),
        closeDate: z.string().nullish(),
        oppStatus: z.string().nullish(),
        docType: z.string().nullish(),
        cfdaList: z.array(z.string()).nullish(),
      }),
    ),
  }),
});

export const GrantsGovOpportunitySchema = z.object({
  errorcode: z.union([z.number(), z.string()]).transform(Number),
  msg: z.string().optional(),
  data: z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    opportunityNumber: z.string(),
    opportunityTitle: z.string(),
    docType: z.string().nullish(),
    /** `POSTED`, `FORECASTED`, `CLOSED`, `ARCHIVED`. */
    ost: z.string().nullish(),
    synopsis: z.object({
      agencyName: z.string().nullish(),
      synopsisDesc: z.string().nullish(),
      responseDate: z.string().nullish(),
      postingDate: z.string().nullish(),
      archiveDate: z.string().nullish(),
      awardCeiling: Dollars,
      awardFloor: Dollars,
      estimatedFunding: Dollars,
      numberOfAwards: z.union([z.number(), z.string()]).nullish(),
      /** The only place geography is ever stated. */
      applicantEligibilityDesc: z.string().nullish(),
      applicantTypes: z.array(CodedValue).nullish(),
      fundingActivityCategories: z.array(CodedValue).nullish(),
    }),
    /** The federal program number: the join key to award history in S5. */
    cfdas: z
      .array(z.object({ cfdaNumber: z.string().nullish(), programTitle: z.string().nullish() }))
      .nullish(),
    synopsisAttachmentFolders: z
      .array(
        z.object({
          folderType: z.string().nullish(),
          folderName: z.string().nullish(),
          synopsisAttachments: z
            .array(
              z.object({
                id: z.union([z.string(), z.number()]).transform(String),
                mimeType: z.string().nullish(),
                fileName: z.string().nullish(),
                fileDescription: z.string().nullish(),
              }),
            )
            .nullish(),
        }),
      )
      .nullish(),
  }),
});

export type GrantsGovOpportunityPayload = z.infer<typeof GrantsGovOpportunitySchema>;
export type GrantsGovSearchPayload = z.infer<typeof GrantsGovSearchResponseSchema>;
