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

  /**
   * ProPublica's Nonprofit Explorer: free, keyless, and the source of the funder financial
   * trend. Overridden in tests to point at a local server serving recorded real payloads.
   */
  PROPUBLICA_BASE_URL: z.string().url().default('https://projects.propublica.org/nonprofits/api/v2'),

  /**
   * The financial trend is supplementary -- the reachability report is built from IRS filings
   * and renders without it -- so it gets a much shorter leash than a bundle download.
   */
  PROPUBLICA_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),

  /** Grants.gov: free, keyless, no registration. The federal opportunity feed. */
  GRANTS_GOV_BASE_URL: z.string().url().default('https://api.grants.gov/v1/api'),
  GRANTS_GOV_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  /**
   * What the sweep searches for. Comma-separated, because a sweep with no terms finds nothing
   * and a sweep of everything is 40,000 announcements. In production these track the
   * organisation's program area.
   */
  FEDERAL_SWEEP_KEYWORDS: z
    .string()
    .default('literacy,adult education,youth development')
    .transform((raw) =>
      raw
        .split(',')
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  /** Hits taken per search term. The sweep is incremental and idempotent, not exhaustive. */
  FEDERAL_SWEEP_PER_KEYWORD: z.coerce.number().int().positive().max(200).default(10),

  /**
   * Gemini. The key is optional: without it Merit screens, stores, and serves everything it
   * already has, and says "not scored yet" rather than failing. Degradation is a designed
   * behaviour, and an unset key is the most complete form of quota exhaustion.
   */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta'),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** The free tier's published limits: 15 requests a minute, 1,500 a day. */
  GEMINI_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(15),
  GEMINI_REQUESTS_PER_DAY: z.coerce.number().int().positive().default(1_500),

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
