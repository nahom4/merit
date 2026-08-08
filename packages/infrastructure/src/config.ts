import { z } from 'zod';

/**
 * Every environment variable Merit reads, declared once and parsed at boot.
 * Missing config fails loudly on startup, never on first use at 3am.
 */
const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required, e.g. file:./data/merit.db'),
  DATABASE_AUTH_TOKEN: z.string().optional(),

  /** Where downloaded IRS bundles and the BMF are staged. Bundles are deleted after parsing. */
  MERIT_DATA_DIR: z.string().default('./data'),

  /** Base URL of the IRS bulk 990 XML bundles. Overridden in tests to point at a local server. */
  IRS_BUNDLE_BASE_URL: z.string().url().default('https://apps.irs.gov/pub/epostcard/990/xml'),
  IRS_BMF_BASE_URL: z.string().url().default('https://www.irs.gov/pub/irs-soi'),

  /** Corpus year to ingest. The IRS publishes one bundle set per calendar year. */
  IRS_CORPUS_YEAR: z.coerce.number().int().min(2015).max(2100).default(2025),

  /** Every outbound call has an explicit timeout. A default is not a policy. */
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
});

export type MeritConfig = z.infer<typeof ConfigSchema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): MeritConfig => {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${detail}\n\nSee .env.example.`);
  }
  return parsed.data;
};
