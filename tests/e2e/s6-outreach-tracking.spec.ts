import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Outreach tracking, executable: from a prospect, draft a letter of inquiry, save who it is going
 * to, hand the draft to Gmail, and find the pursuit again on a list of every funder being chased.
 *
 * Gmail itself is not driven here and could not be — the compose window is Google's page, and
 * Merit deliberately stops at its door: it never sends and never contacts a funder. What this
 * proves end to end is Merit's half: the record persists, the compose link carries the real
 * letter, and the list tells the truth about what has and has not been synced back. The push
 * path that turns "draft" into "sent" is proved against a real database in
 * `tests/integration/sync-gmail-outreach.int.test.ts`.
 */

const FUNDER_CONTACT = 'grants@example-foundation.org';

/** One organisation per test, keyed off the title — the app enforces one profile per EIN, and a
 *  module counter does not survive Playwright restarting a worker after a failure. */
const einFor = (title: string): string => {
  let hash = 0;
  for (const character of title) hash = (hash * 31 + character.charCodeAt(0)) % 89_999_999;
  return String(410_000_000 + hash);
};

const createProfile = async (page: Page, title: string): Promise<string> => {
  const ein = einFor(title);
  await page.goto('/organizations/new');
  await page.getByLabel('Organisation name').fill(`Coastal Literacy Project ${ein}`);
  await page.getByLabel('EIN').fill(ein);
  await page.getByLabel('City').fill('Wilmington');
  await page.getByLabel('State').fill('FL');
  await page.getByLabel('NTEE program code').fill('B60');
  await page.getByLabel('Annual revenue (USD)').fill('600000');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page).toHaveURL(/\/organizations\/org_/);
  return page.url();
};

/** The path a user actually walks: profile, prospects, a funder's report, its letter. */
const openLetter = async (page: Page, title: string): Promise<{ profileUrl: string }> => {
  const profileUrl = await createProfile(page, title);

  await page.goto(`${profileUrl}/prospects`);
  await expect(page.getByTestId('prospect-card').first()).toBeVisible();
  await page.getByTestId('prospect-card').first().getByRole('link', { name: 'Reachability report' }).click();
  await expect(page).toHaveURL(/\/funders\/\d{9}$/);

  await page.getByTestId('letter-link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Letter of inquiry' })).toBeVisible({
    timeout: 60_000,
  });
  return { profileUrl };
};

test('saves the recipient and hands the real letter to Gmail', async ({ page }) => {
  await openLetter(page, test.info().title);

  await page.getByLabel('Recipient email').fill(FUNDER_CONTACT);
  await page.getByRole('button', { name: 'Save outreach' }).click();

  // The link exists before the save too, unaddressed — so wait for the saved recipient to reach it
  // rather than reading whichever href happens to be in the DOM first.
  const compose = page.getByRole('link', { name: 'Open in Gmail' });
  await expect(compose).toHaveAttribute('href', /to=grants%40example-foundation\.org/);

  // The link is Gmail's compose window, addressed and prefilled — not a mailto: that loses the body.
  const href = await compose.getAttribute('href');
  expect(href).not.toBeNull();
  const composeUrl = new URL(href ?? '');
  expect(composeUrl.origin + composeUrl.pathname).toBe('https://mail.google.com/mail/');
  expect(composeUrl.searchParams.get('view')).toBe('cm');
  expect(composeUrl.searchParams.get('to')).toBe(FUNDER_CONTACT);
  expect(composeUrl.searchParams.get('su')).toContain('Funding inquiry');

  // The body carried across is the letter on this page, not a placeholder.
  const body = composeUrl.searchParams.get('body') ?? '';
  const drafted = await page.getByTestId('section-text').first().innerText();
  expect(body.replace(/\s+/gu, ' ')).toContain(drafted.replace(/\s+/gu, ' ').slice(0, 60));
});

test('remembers the recipient on the next visit', async ({ page }) => {
  await openLetter(page, test.info().title);

  await page.getByLabel('Recipient email').fill(FUNDER_CONTACT);
  await page.getByRole('button', { name: 'Save outreach' }).click();
  await expect(page.getByRole('link', { name: 'Open in Gmail' })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Recipient email')).toHaveValue(FUNDER_CONTACT);
});

test('lists the pursuit, and says Gmail is not connected rather than implying it is', async ({ page }) => {
  const { profileUrl } = await openLetter(page, test.info().title);

  const funderName = await page.locator('form h2').innerText();
  await page.getByLabel('Recipient email').fill(FUNDER_CONTACT);
  await page.getByRole('button', { name: 'Save outreach' }).click();
  await expect(page.getByRole('link', { name: 'Open in Gmail' })).toBeVisible();

  await page.goto(`${profileUrl}/outreach`);
  await expect(page.getByRole('heading', { name: 'Pursued funders' })).toBeVisible();

  const row = page.locator('article').filter({ hasText: FUNDER_CONTACT });
  await expect(row).toBeVisible();
  await expect(row).toContainText(funderName);

  // Nothing has been sent, and the screen says so rather than showing an optimistic status.
  await expect(row).toContainText('draft');

  // No OAuth credential in this run, so the honest answer is the one on the screen.
  await expect(page.getByText('Gmail not connected')).toBeVisible();
});

test('offers an empty outreach list that explains itself', async ({ page }) => {
  const profileUrl = await createProfile(page, test.info().title);

  await page.goto(`${profileUrl}/outreach`);
  await expect(page.getByText('No outreach has been saved yet')).toBeVisible();
});

test('never claims to have sent anything on the users behalf', async ({ page }) => {
  await openLetter(page, test.info().title);

  const body = page.locator('body');
  await expect(body).toContainText('never submits');
  await expect(body).not.toContainText('Sent to');
});

test('works on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { profileUrl } = await openLetter(page, test.info().title);

  await page.getByLabel('Recipient email').fill(FUNDER_CONTACT);
  await page.getByRole('button', { name: 'Save outreach' }).click();
  await expect(page.getByRole('link', { name: 'Open in Gmail' })).toBeVisible();

  await page.goto(`${profileUrl}/outreach`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
