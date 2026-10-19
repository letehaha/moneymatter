import { test, expect } from '@playwright/test';

import { completeOnboarding, createAccount, createPortfolio, setPortfolioCash } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';
import { pickDialogSelect, waitForSuccessToast } from '../../helpers/ui';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'ptx' });

let portfolioA: { id: string; name: string };
let portfolioB: { id: string; name: string };
let testAccount: { id: string; name: string };
let dataSeeded = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

async function seedTestData({ request }: { request: import('@playwright/test').APIRequestContext }): Promise<void> {
  if (dataSeeded) return;

  await completeOnboarding({ request, currencyCode: CURRENCY });

  const pA = await createPortfolio({ request, name: 'E2E Portfolio Alpha' });
  portfolioA = { id: pA.response.id, name: 'E2E Portfolio Alpha' };

  const pB = await createPortfolio({ request, name: 'E2E Portfolio Beta' });
  portfolioB = { id: pB.response.id, name: 'E2E Portfolio Beta' };

  await setPortfolioCash({ request, portfolioId: portfolioA.id, currencyCode: CURRENCY, amount: '5000' });

  const acc = await createAccount({
    request,
    name: 'E2E Transfer Account',
    currencyCode: CURRENCY,
    initialBalance: 10000,
  });
  testAccount = { id: acc.response?.id ?? acc.id, name: 'E2E Transfer Account' };

  dataSeeded = true;
}

// ─── UI helpers specific to this suite ───────────────────────────────

async function submitTransferAndConfirm({ page }: { page: import('@playwright/test').Page }): Promise<void> {
  const dialog = page.getByRole('dialog');

  const submitBtn = dialog
    .getByRole('button')
    .filter({ hasText: /transfer/i })
    .last();
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();

  await expect(page.getByRole('button', { name: /confirm/i })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /confirm/i }).click();

  await waitForSuccessToast({ page });
}

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('Portfolio Transfers', () => {
  test.use({
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    await seedTestData({ request: page.request });

    await page.goto('/dashboard');
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('portfolio-to-portfolio transfer', async ({ page }) => {
    await page.goto(`/portfolios/${portfolioA.id}`);
    await page.waitForSelector('h1');

    await page.getByRole('button', { name: /^transfer$/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await pickDialogSelect({ page, nth: 2, optionName: portfolioB.name });
    await pickDialogSelect({ page, nth: 3, optionName: CURRENCY });

    await page.getByRole('dialog').locator('input[type="number"]').fill('100');

    await submitTransferAndConfirm({ page });
  });

  test('portfolio-to-account transfer', async ({ page }) => {
    await page.goto(`/portfolios/${portfolioA.id}`);
    await page.waitForSelector('h1');

    await page.getByRole('button', { name: /^transfer$/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await pickDialogSelect({ page, nth: 0, optionName: /account/i });

    await pickDialogSelect({ page, nth: 2, optionName: testAccount.name });
    await pickDialogSelect({ page, nth: 3, optionName: CURRENCY });

    await page.getByRole('dialog').locator('input[type="number"]').fill('50');

    await submitTransferAndConfirm({ page });
  });

  test('account-to-portfolio transfer', async ({ page }) => {
    await page.goto(`/account/${testAccount.id}`);

    const transferBtn = page.getByRole('button', { name: /transfer to portfolio/i });
    await expect(transferBtn).toBeVisible({ timeout: 15_000 });
    await transferBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await pickDialogSelect({ page, nth: 2, optionName: portfolioA.name });

    await page.getByRole('dialog').locator('input[type="number"]').fill('200');

    await submitTransferAndConfirm({ page });
  });

  test('submit button is disabled when fields are empty', async ({ page }) => {
    await page.goto(`/portfolios/${portfolioA.id}`);
    await page.waitForSelector('h1');

    await page.getByRole('button', { name: /^transfer$/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const submitBtn = page
      .getByRole('dialog')
      .getByRole('button')
      .filter({ hasText: /transfer/i })
      .last();
    await expect(submitBtn).toBeDisabled();
  });
});
