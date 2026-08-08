import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S1's acceptance criterion, executable: a real profile goes in, a ranked list of funders
 * comes out, each with four separate score components and grantee rows one click away.
 *
 * The seeded graph is the fixture IRS bundle ingested through the real use cases, so what
 * this renders came out of an actual filing.
 */
/** Each profile gets its own EIN: one organisation per EIN is a rule the app enforces, and
 *  a suite that reuses one would be testing the duplicate check by accident. */
let einCounter = 100_000_000;
const nextEin = () => String((einCounter += 137));

const createProfile = async (
  page: Page,
  {
    state,
    nteeCode = 'B60',
    revenue = '600000',
    name = 'Coastal Literacy Project',
  }: {
    state: string;
    nteeCode?: string;
    revenue?: string;
    name?: string;
  },
) => {
  await page.goto('/organizations/new');
  await page.getByLabel('Organisation name').fill(`${name} ${nextEin()}`);
  await page.getByLabel('EIN').fill(nextEin());
  await page.getByLabel('City').fill('Wilmington');
  await page.getByLabel('State').fill(state);
  await page.getByLabel('NTEE program code').fill(nteeCode);
  await page.getByLabel('Annual revenue (USD)').fill(revenue);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page).toHaveURL(/\/organizations\/org_/);
  return page.url();
};

test('ranks funders with four separate score components and inspectable evidence', async ({ page }) => {
  const profileUrl = await createProfile(page, { state: 'FL' });

  await page.getByRole('link', { name: 'See funder prospects' }).click();
  await expect(page).toHaveURL(`${profileUrl}/prospects`);

  const cards = page.getByTestId('prospect-card');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);

  const first = cards.first();
  // Four bars, never one number. This is a product rule, not a layout preference.
  await expect(first.getByTestId('bar-value-Openness')).toBeVisible();
  await expect(first.getByTestId('bar-value-Affinity')).toBeVisible();
  await expect(first.getByTestId('bar-value-Geography')).toBeVisible();
  await expect(first.getByTestId('bar-value-Size fit')).toBeVisible();
  await expect(first).not.toContainText('Overall score');

  // Every score is one click from the grantee rows behind it.
  await first
    .getByRole('group')
    .getByText(/Show the \d+ grantee/)
    .click();
  await expect(first.getByRole('table')).toBeVisible();
  await expect(first.getByRole('columnheader', { name: 'Organisation' })).toBeVisible();
  await expect(first.getByRole('columnheader', { name: 'Amount' })).toBeVisible();
});

test('states coverage in-product rather than implying completeness', async ({ page }) => {
  const profileUrl = await createProfile(page, { state: 'NY' });
  await page.goto(`${profileUrl}/prospects`);

  await expect(page.getByTestId('coverage')).toContainText(/\d+ comparable organisations found/);
  await expect(page.getByTestId('coverage')).toContainText(/funders of those organisations were examined/);
});

test('names the materiality floor that excluded the small funders', async ({ page }) => {
  const profileUrl = await createProfile(page, { state: 'NY' });
  await page.goto(`${profileUrl}/prospects`);
  await expect(page.getByText(/Funders whose median grant falls below \$3,000 are excluded/)).toBeVisible();
});

test('explains an empty prospect list instead of rendering a blank panel', async ({ page }) => {
  // V21 is a social-science program area, which nothing in the seeded graph belongs to.
  const profileUrl = await createProfile(page, {
    state: 'WY',
    nteeCode: 'V21',
    revenue: '40000',
    name: 'Rare Program Trust',
  });

  await page.goto(`${profileUrl}/prospects`);
  await expect(page.getByTestId('empty-reason')).toBeVisible();
  await expect(page.getByTestId('empty-reason')).toContainText('No comparable organisations were found');
  await expect(page.getByTestId('prospect-card')).toHaveCount(0);
});

test('works on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const profileUrl = await createProfile(page, { state: 'FL' });
  await page.goto(`${profileUrl}/prospects`);

  await expect(page.getByTestId('prospect-card').first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
