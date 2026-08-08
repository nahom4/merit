import { expect, test } from '@playwright/test';

/**
 * S0's acceptance criterion, executable: create a profile in the UI, reload, see it.
 * One trivial feature travelling every layer proves the architecture before real logic lands.
 */
test('creates an organisation profile and reads it back after a reload', async ({ page }) => {
  await page.goto('/organizations/new');

  await page.getByLabel('Organisation name').fill('Cape Fear Literacy Council');
  await page.getByLabel('EIN').fill('58-1613254');
  await page.getByLabel('City').fill('Wilmington');
  await page.getByLabel('State').fill('NC');
  await page.getByLabel('NTEE program code').fill('B60');
  await page.getByLabel('Annual revenue (USD)').fill('655738');
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect(page).toHaveURL(/\/organizations\/org_/);
  await expect(page.getByRole('heading', { name: 'Cape Fear Literacy Council' })).toBeVisible();

  const profileUrl = page.url();
  await page.reload();

  await expect(page).toHaveURL(profileUrl);
  await expect(page.getByTestId('profile-ein')).toHaveText('58-1613254');
  await expect(page.getByTestId('profile-program-area')).toHaveText('Education (B60)');
  await expect(page.getByTestId('profile-revenue')).toHaveText('$655,738');
  await expect(page.getByTestId('profile-materiality-floor')).toHaveText('$3,279');
  await expect(page.getByTestId('profile-region')).toHaveText('NC, GA, SC, TN, VA');
});

test('refuses a second profile for the same EIN and says why', async ({ page }) => {
  const fill = async () => {
    await page.goto('/organizations/new');
    await page.getByLabel('Organisation name').fill('Lake County Free Clinic');
    await page.getByLabel('EIN').fill('341081191');
    await page.getByLabel('City').fill('Painesville');
    await page.getByLabel('State').fill('OH');
    await page.getByLabel('NTEE program code').fill('E32');
    await page.getByLabel('Annual revenue (USD)').fill('1200000');
    await page.getByRole('button', { name: 'Save profile' }).click();
  };

  await fill();
  await expect(page).toHaveURL(/\/organizations\/org_/);

  await fill();
  await expect(page.getByTestId('form-error')).toHaveText(
    'An organisation with this EIN is already on file.',
  );
});

test('explains an unusable field instead of failing silently', async ({ page }) => {
  await page.goto('/organizations/new');
  await page.getByLabel('Organisation name').fill('Nowhere Trust');
  await page.getByLabel('EIN').fill('123456789');
  await page.getByLabel('City').fill('Atlantis');
  await page.getByLabel('State').fill('ZZ');
  await page.getByLabel('NTEE program code').fill('B60');
  await page.getByLabel('Annual revenue (USD)').fill('1000');
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect(page.getByTestId('form-error')).toContainText('state must be a US jurisdiction code');
});

test('says so plainly when a profile does not exist', async ({ page }) => {
  await page.goto('/organizations/org_does_not_exist');
  await expect(page.getByRole('heading', { name: 'No such organisation' })).toBeVisible();
});
