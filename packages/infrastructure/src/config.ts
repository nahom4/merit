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
   * Attachments come from a different host than the API. `api.grants.gov/v1/api` answers 403
   * for them; the file itself is at `grants.gov/grantsws/rest/opportunity/att/download/{id}`.
   * Verified live on 8 August 2026 -- attachment 354136 returns 200, application/pdf, 303,791
   * bytes -- and kept honest by `tests/contract/grants-gov.contract.test.ts`.
   */
  GRANTS_GOV_ATTACHMENT_BASE_URL: z
    .string()
    .url()
    .default('https://grants.gov/grantsws/rest/opportunity/att/download'),
  /** A 60-page NOFO is a few hundred kilobytes; the ceiling is for what is not a NOFO. */
  GRANTS_GOV_ATTACHMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
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

  /** Scheduled work can deliver to Google Calendar and Gmail when OAuth is configured. */
  GOOGLE_OAUTH_ACCESS_TOKEN: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_GMAIL_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_GMAIL_WATCH_TOPIC_NAME: z.string().optional(),
  /** Sign-in reuses the same OAuth client; only the redirect differs. */
  GOOGLE_AUTH_REDIRECT_URI: z.string().url().default('http://localhost:3000/api/auth/google/callback'),
  GOOGLE_CALENDAR_BASE_URL: z.string().url().default('https://www.googleapis.com/calendar/v3'),
  GOOGLE_CALENDAR_ID: z.string().default('primary'),
  // Where this Merit is reachable, for links that leave the app and have to come back --
  // a calendar reminder is read on a phone, days later, with no tab open.
  MERIT_APP_BASE_URL: z.string().url().default('http://localhost:3100'),
  GOOGLE_GMAIL_BASE_URL: z.string().url().default('https://gmail.googleapis.com/gmail/v1'),
  GOOGLE_GMAIL_USER_ID: z.string().default('me'),

  /** Recipients for the scheduled jobs, comma-separated so Cloud Scheduler can stay simple. */
  SCHEDULED_ALERT_RECIPIENTS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  SCHEDULED_BRIEFING_RECIPIENTS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),

  /**
   * The shared secret the scheduler presents as `Authorization: Bearer <secret>`.
   * Unset, the scheduled endpoints refuse every request rather than running unauthenticated:
   * a sweep anyone can trigger is a way to burn a day's model quota from outside.
   */
  CRON_SECRET: z.string().min(16).optional(),

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
