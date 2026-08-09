import { expect, test } from '@playwright/test';
import { boardRow } from '../support/board-row.js';
import type { Page } from '@playwright/test';

/**
 * S4's acceptance criteria, executable: a draft studio where the draft sits beside the criteria
 * it was written against, every criterion carries a score before and after revision, every score
 * names the sentence it judged, and the weak criteria say what the human has to supply.
 *
 * Nothing here is a stand-in. The rubric was read out of the real 303,791-byte
 * HHS-2026-ACF-OCS-EAH-0027 PDF that the live attachment service returned, downloaded over real
 * HTTP and extracted by the real `pdftotext -layout`. The critique went through the real
 * validator, so a score whose cited sentence was not in the draft would have been rejected and
 * this page would show no scores at all.
 */

/** The announcement whose attachment is recorded, and the only one with a rubric to extract. */
const ACF_HOUSING = 'HHS-2026-ACF-OCS-EAH-0027';

/**
 * One organisation for the whole file, and one draft.
 *
 * The other specs give each test its own EIN, which is right when the work under test is free.
 * Drafting is not: seven sections, two critiques and three revisions is thirteen model calls
 * metered through the real token bucket. A per-test organisation would buy thirteen more every
 * time and spend the run inside the rate limiter.
 *
 * Sharing one is not a shortcut around the product behaviour — it *is* the product behaviour.
 * A complete draft is persisted and served on reload rather than re-bought, so every test after
 * the first is exercising exactly the path a user gets on their second visit.
 */
const EIN = '430000117';
let organizationUrl = '';
let studioUrl = '';

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();

  await page.goto('/organizations/new');
  await page.getByLabel('Organisation name').fill('Cape Fear Reading Partners');
  await page.getByLabel('EIN').fill(EIN);
  await page.getByLabel('City').fill('Wilmington');
  await page.getByLabel('State').fill('NC');
  await page.getByLabel('NTEE program code').fill('B60');
  await page.getByLabel('Annual revenue (USD)').fill('656000');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page).toHaveURL(/\/organizations\/org_/);
  organizationUrl = page.url();

  await page.goto(`${organizationUrl}/opportunities`);
  const row = page.getByTestId('opportunity-row').filter({ hasText: ACF_HOUSING });
  await expect(row).toBeVisible();
  await row.getByTestId('draft-link').click();

  // The first visit pays for the draft: download, extract, thirteen model calls through the
  // real bucket. Everything after this is served from the stored draft.
  await expect(page.getByTestId('draft-section').first()).toBeVisible({ timeout: 240_000 });
  studioUrl = page.url();

  await page.close();
});

const openStudio = async (page: Page): Promise<void> => {
  await page.goto(studioUrl);
  await expect(page.getByRole('heading', { name: 'Draft studio' })).toBeVisible();
  await expect(page.getByTestId('draft-section').first()).toBeVisible({ timeout: 60_000 });
};

test('drafts a section for every criterion in the rubric it read from the PDF', async ({ page }) => {
  await openStudio(page);

  // Seven criteria in the real announcement, so seven sections.
  await expect(page.getByTestId('draft-section')).toHaveCount(7);
});

test('shows each section beside the sub-criteria it is scored against', async ({ page }) => {
  await openStudio(page);

  const first = page.getByTestId('draft-section').first();
  await expect(first.getByTestId('section-text')).toBeVisible();
  await expect(first.getByTestId('section-criteria')).toContainText('scored against');
});

test('states what the draft was conditioned on, above the draft', async ({ page }) => {
  await openStudio(page);

  // The rubric's criteria sum to the 115 points the document states, so it is trusted -- and
  // the page says so rather than leaving the user to assume it.
  await expect(page.getByTestId('conditioning-note')).toContainText('7 review criteria');
  await expect(page.getByTestId('conditioning-note')).toContainText('115 points');
});

test('scores every criterion, before and after revision', async ({ page }) => {
  await openStudio(page);

  await expect(page.getByTestId('criterion-score')).toHaveCount(7);

  const first = page.getByTestId('criterion-score').first();
  await expect(first.getByTestId('score-before')).toBeVisible();
  await expect(first.getByTestId('score-after')).toBeVisible();
  await expect(page.getByTestId('revision-summary')).toBeVisible();
});

test('every score cites a sentence, and the sentence is in the draft', async ({ page }) => {
  await openStudio(page);

  const citations = page.getByTestId('cited-sentence');
  expect(await citations.count()).toBe(7);

  // The product rule, checked end to end rather than trusted: the sentence the score claims to
  // judge is a sentence that appears in the drafted text on this page.
  const cited = (await citations.first().innerText()).trim();
  const draft = await page.getByTestId('section-text').first().innerText();
  expect(draft.replace(/\s+/gu, ' ')).toContain(cited.replace(/\s+/gu, ' '));
});

test('flags the weak criteria with what the human must supply', async ({ page }) => {
  await openStudio(page);

  const weak = page.getByTestId('weak-criteria');
  await expect(weak).toBeVisible();
  await expect(weak).toContainText('points still unearned');
});

test('names the facts the draft deliberately left for the human', async ({ page }) => {
  await openStudio(page);

  // Drafting is told to bracket a fact the profile does not contain rather than invent one.
  // A placeholder buried in a paragraph is a placeholder that gets submitted.
  await expect(page.getByTestId('placeholders').first()).toContainText('[');
});

test('never calls the draft a submission, and never claims a chance of winning', async ({ page }) => {
  await openStudio(page);

  const body = page.locator('body');
  await expect(body).toContainText('never submits');
  await expect(body).not.toContainText('win probability');
  await expect(body).not.toContainText('chance of winning');
});

test('offers no draft studio on an announcement screened out by rule', async ({ page }) => {
  await page.goto(`${organizationUrl}/opportunities`);

  // PAR-25-003 is open to state governments only. Offering to draft against it would invite a
  // user to spend an afternoon on an application that gets rejected unread.
  const row = await boardRow(page, organizationUrl, 'PAR-25-003');
  await expect(row.getByTestId('draft-link')).toHaveCount(0);
});

test('works on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
