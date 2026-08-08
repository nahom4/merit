import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S2's acceptance criteria, executable: from a prospect on the list, open the funder and get
 * a report that answers "should we bother" -- who it funds by year, how its list turns over,
 * what a first ask actually looks like, how close it is to us in the shared-funder graph,
 * what its finances are doing, and a brief in which every claim names the filing behind it.
 *
 * The seeded graph is the fixture IRS bundle ingested through the real use cases, and the
 * financial trend comes from a real ProPublica payload served by a local fixture server.
 * Nothing on this screen is invented.
 */
/**
 * Each test gets its own EIN, derived from its own title.
 *
 * One organisation per EIN is a rule the app enforces, so the suite must not reuse one. A
 * module-level counter is not enough: Playwright restarts the worker process after a failed
 * test, which resets module state and hands the next test an EIN the first one already used —
 * turning one real failure into three confusing ones. A hash of the title survives that.
 */
const einFor = (title: string): string => {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) % 89_999_999;
  return String(310_000_000 + hash);
};

const createProfile = async (page: Page, title: string, { state = 'FL' }: { state?: string } = {}) => {
  const ein = einFor(title);
  await page.goto('/organizations/new');
  await page.getByLabel('Organisation name').fill(`Coastal Literacy Project ${ein}`);
  await page.getByLabel('EIN').fill(ein);
  await page.getByLabel('City').fill('Wilmington');
  await page.getByLabel('State').fill(state);
  await page.getByLabel('NTEE program code').fill('B60');
  await page.getByLabel('Annual revenue (USD)').fill('600000');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page).toHaveURL(/\/organizations\/org_/);
  return page.url();
};

/** Walks the path a user actually takes: profile, prospect list, first funder's report. */
const openFirstFunderReport = async (page: Page, title: string): Promise<void> => {
  const profileUrl = await createProfile(page, title);
  await page.goto(`${profileUrl}/prospects`);
  await expect(page.getByTestId('prospect-card').first()).toBeVisible();
  await page.getByTestId('prospect-card').first().getByRole('link', { name: 'Reachability report' }).click();
  await expect(page).toHaveURL(/\/funders\/\d{9}$/);
};

test('reaches the report from a prospect and names the funder', async ({ page }) => {
  await openFirstFunderReport(page, test.info().title);
  await expect(page.getByTestId('funder-report-name')).toBeVisible();
});

test('shows the grantee list by year with turnover over time', async ({ page }) => {
  await openFirstFunderReport(page, test.info().title);

  const byYear = page.getByTestId('grantees-by-year');
  await expect(byYear).toBeVisible();
  await expect(byYear.getByRole('columnheader', { name: 'Year' })).toBeVisible();
  await expect(byYear.getByRole('columnheader', { name: 'Grantees' })).toBeVisible();
  await expect(byYear.getByRole('columnheader', { name: 'Turnover' })).toBeVisible();
  await expect(byYear.getByRole('row')).not.toHaveCount(1);
});

test('shows the ask distribution, geographic spread, and program mix', async ({ page }) => {
  await openFirstFunderReport(page, test.info().title);

  await expect(page.getByTestId('ask-distribution')).toBeVisible();
  await expect(page.getByTestId('ask-distribution')).toContainText('Median');
  await expect(page.getByTestId('geographic-spread')).toBeVisible();
  await expect(page.getByTestId('program-mix')).toBeVisible();
});

test('calibrates a recommended ask and states what it was calculated from', async ({ page }) => {
  await openFirstFunderReport(page, test.info().title);

  const calibration = page.getByTestId('ask-calibration');
  await expect(calibration).toBeVisible();
  await expect(calibration.getByTestId('recommended-ask')).toContainText('$');
  // The number is never bare: the basis and the sample it rests on are stated beside it.
  await expect(calibration.getByTestId('calibration-basis')).toBeVisible();
});

test('labels affinity paths as shared-funder proximity, never as a personal connection', async ({ page }) => {
  await openFirstFunderReport(page, test.info().title);

  const paths = page.getByTestId('affinity-paths');
  await expect(paths).toBeVisible();
  await expect(paths).toContainText('shared-funder proximity');
  await expect(paths).toContainText('not a personal connection');
  await expect(paths).not.toContainText('introduction');
});

test('renders the financial trend, or says plainly that it is unavailable', async ({ page }) => {
  await openFirstFunderReport(page, test.info().title);
  await expect(page.getByTestId('financial-trend')).toBeVisible();
});

test('cites a source on every claim in the funder brief', async ({ page }) => {
  await openFirstFunderReport(page, test.info().title);

  const brief = page.getByTestId('funder-brief');
  await expect(brief).toBeVisible();

  const claims = brief.getByTestId('brief-claim');
  expect(await claims.count()).toBeGreaterThan(0);

  // The product rule, checked rather than trusted: no claim renders without a citation.
  // A claim may cite more than one source -- the program mix rests on the filings and on the
  // registry -- so this counts them rather than expecting exactly one.
  for (const claim of await claims.all()) {
    expect(await claim.getByTestId('brief-citation').count()).toBeGreaterThan(0);
  }
});

test('states explicitly what the evidence does not support', async ({ page }) => {
  await openFirstFunderReport(page, test.info().title);

  const limits = page.getByTestId('brief-limitations');
  await expect(limits).toBeVisible();
  await expect(limits).toContainText('does not');
  // Never a win probability. Public filings have no denominator.
  await expect(page.getByTestId('funder-brief')).not.toContainText('probability');
});

test('works on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFirstFunderReport(page, test.info().title);

  await expect(page.getByTestId('funder-brief')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
