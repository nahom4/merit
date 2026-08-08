import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S3's acceptance criteria, executable: a federal opportunity board where every row is either
 * screened out with a reason a human can read, or scored for fit with the matched program areas
 * and the gaps beside the number -- never a bare score, and never a score on a row the
 * organisation cannot legally apply for.
 *
 * The opportunities were swept in global setup through the real gateway and the real use case,
 * from payloads the live Grants.gov API actually returned (`tests/fixtures/grants-gov/`, kept
 * honest by the nightly contract test). The fit scores come through the real orchestrator and
 * the real repair loop.
 */

/** Each test gets its own EIN, derived from its own title -- see s2 for why a counter is not
 *  enough. One organisation per EIN is a rule the app enforces, so the suite must not reuse one. */
const einFor = (title: string): string => {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) % 89_999_999;
  return String(420_000_000 + hash);
};

/** North Carolina, deliberately: the Delta States announcement in the fixture limits itself to
 *  eight states that do not include it, which is what exercises the geography rule end to end. */
const openBoard = async (page: Page, title: string): Promise<void> => {
  const ein = einFor(title);
  await page.goto('/organizations/new');
  await page.getByLabel('Organisation name').fill(`Cape Fear Reading Partners ${ein}`);
  await page.getByLabel('EIN').fill(ein);
  await page.getByLabel('City').fill('Wilmington');
  await page.getByLabel('State').fill('NC');
  await page.getByLabel('NTEE program code').fill('B60');
  await page.getByLabel('Annual revenue (USD)').fill('656000');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page).toHaveURL(/\/organizations\/org_/);

  await page.goto(`${page.url()}/opportunities`);
  await expect(page.getByTestId('opportunity-row').first()).toBeVisible();
};

test('lists the swept federal opportunities with their program numbers', async ({ page }) => {
  await openBoard(page, test.info().title);

  const rows = page.getByTestId('opportunity-row');
  expect(await rows.count()).toBeGreaterThan(1);
  // The federal program number is the join key to award history in S5. It must survive the
  // sweep and reach the screen.
  await expect(rows.first().getByTestId('program-number')).toBeVisible();
});

test('screens out an announcement open only to state governments, with a readable reason', async ({
  page,
}) => {
  await openBoard(page, test.info().title);

  const row = page.getByTestId('opportunity-row').filter({ hasText: 'PAR-25-003' });
  await expect(row).toBeVisible();
  await expect(row.getByTestId('screening-reason')).toContainText('State governments');
  // No model was asked about an opportunity this organisation cannot apply for.
  await expect(row.getByTestId('fit-score')).toHaveCount(0);
});

test('screens out an announcement limited to states this organisation is not in', async ({ page }) => {
  await openBoard(page, test.info().title);

  const row = page.getByTestId('opportunity-row').filter({ hasText: 'HRSA-26-045' });
  await expect(row).toBeVisible();
  await expect(row.getByTestId('screening-reason')).toContainText('Tennessee');
  await expect(row.getByTestId('screening-reason')).toContainText('North Carolina');
});

test('scores an eligible opportunity, never as a bare number', async ({ page }) => {
  await openBoard(page, test.info().title);

  const scored = page.getByTestId('opportunity-row').filter({ has: page.getByTestId('fit-score') });
  expect(await scored.count()).toBeGreaterThan(0);

  const first = scored.first();
  await expect(first.getByTestId('fit-score')).toContainText('/100');
  // The product rule: a score never ships alone. Matched program areas and what the
  // announcement asks for that this organisation cannot show are rendered beside it.
  await expect(first.getByTestId('matched-programs')).toBeVisible();
  await expect(first.getByTestId('fit-gaps')).toBeVisible();
  await expect(first.getByTestId('fit-rationale')).toBeVisible();
});

test('states which eligibility checks could not be decided rather than guessing', async ({ page }) => {
  await openBoard(page, test.info().title);
  await expect(page.getByTestId('unresolved-check').first()).toBeVisible();
});

test('reports the run in numbers: records, faults, model spend, cache hits', async ({ page }) => {
  await openBoard(page, test.info().title);

  const log = page.getByTestId('run-log');
  await expect(log).toBeVisible();
  await expect(log).toContainText('opportunities');
  await expect(log).toContainText('parse faults');
  await expect(log).toContainText('cache hits');

  // Coverage is stated separately, and it is what says how much of the board was rejected
  // before any model was asked.
  await expect(page.getByTestId('board-coverage')).toContainText('screened out');
});

test('never calls the fit score a win probability', async ({ page }) => {
  await openBoard(page, test.info().title);
  await expect(page.locator('body')).not.toContainText('win probability');
  await expect(page.locator('body')).not.toContainText('chance of winning');
});

test('works on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBoard(page, test.info().title);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
