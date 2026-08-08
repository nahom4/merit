import { z } from 'zod';

/**
 * The ProPublica Nonprofit Explorer payload, parsed at the edge.
 *
 * Only the fields Merit actually reads are declared. Everything else in the response -- and
 * there is a great deal of it -- is ignored by design: declaring fields we do not use would
 * make the schema break on drift that does not affect us.
 *
 * Money arrives in whole dollars. It becomes integer cents before it crosses into the domain.
 */

/** Present on every filing row but frequently null, and null is a fact: the figure is not
 *  on the return, which is different from the figure being zero. */
const NullableAmount = z
  .number()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const ProPublicaFilingSchema = z.object({
  tax_prd_yr: z.number().int(),
  /** 0 = Form 990, 1 = Form 990-EZ, 2 = Form 990-PF. Verified against the live API. */
  formtype: z.number().int(),
  totrevenue: NullableAmount,
  totfuncexpns: NullableAmount,
  totassetsend: NullableAmount,
  /** Contributions and grants paid, per books. 990-PF only. */
  contrpdpbks: NullableAmount,
});

export const ProPublicaOrganizationSchema = z.object({
  organization: z.object({
    ein: z.number().int(),
    name: z.string(),
  }),
  filings_with_data: z.array(ProPublicaFilingSchema).default([]),
});

export type ProPublicaFiling = z.infer<typeof ProPublicaFilingSchema>;
export type ProPublicaOrganization = z.infer<typeof ProPublicaOrganizationSchema>;
