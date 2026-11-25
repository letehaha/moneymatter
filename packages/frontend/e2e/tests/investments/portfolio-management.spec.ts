import { test, expect } from '@playwright/test';

import {
  apiPost,
  completeOnboarding,
  createHolding,
  createInvestmentTransaction,
  createPortfolio,
  setPortfolioCash,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';
import { pickDialogSelect, waitForSuccessToast } from '../../helpers/ui';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'pm' });

let portfolioId: string;
let dataSeeded = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

async function seedTestData({ request }: { request: import('@playwright/test').APIRequestContext }): Promise<void> {
  if (dataSeeded) return;

  await completeOnboarding({ request, currencyCode: CURRENCY });

  const pRes = await createPortfolio({ request, name: 'E2E Portfolio' });
  portfolioId = pRes.response.id;

  const holdingRes = await createHolding({
    request,
    portfolioId,
    symbol: 'ETEST',
  });

  await setPortfolioCash({ request, portfolioId, currencyCode: CURRENCY, amount: '10000' });

  // Seed a buy tx so the holding has quantity > 0. Zero-quantity holdings now
  // collapse under a "Closed positions" group in the holdings table, hiding
  // the row from the assertions below.
  await createInvestmentTransaction({
    request,
    portfolioId,
    securityId: holdingRes.response.securityId,
    category: 'buy',
    date: '2026-01-02',
    quantity: '10',
    price: '100',
  });

  dataSeeded = true;
}

// ─── UI helpers specific to this suite ───────────────────────────────

async function openCashTransactionDialog({ page }: { page: import('@playwright/test').Page }): Promise<void> {
  await page.getByRole('button', { name: /add cash transaction/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function openHoldingTransactionDialog({ page }: { page: import('@playwright/test').Page }): Promise<void> {
  await page.getByRole('button', { name: 'Add transaction for ETEST' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function openActivity({
  page,
  filter,
}: {
  page: import('@playwright/test').Page;
  filter: 'trades' | 'cash';
}): Promise<import('@playwright/test').Locator> {
  await page.getByRole('tab', { name: /^activity$/i }).click();
  const panel = page.getByRole('tabpanel', { name: /^activity$/i });
  await panel.locator(`button[data-value="${filter}"]`).click();
  return panel;
}

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('Portfolio Management', () => {
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

  // ─── Holdings ────────────────────────────────────────────────────

  test.describe('Holdings', () => {
    test('holding appears in table after API seeding', async ({ page }) => {
      await page.goto(`/portfolios/${portfolioId}`);
      await page.waitForSelector('h1');

      await expect(page.locator('table').first()).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('td').filter({ hasText: 'ETEST' }).first()).toBeVisible();
    });

    test('portfolio detail shows correct name', async ({ page }) => {
      await page.goto(`/portfolios/${portfolioId}`);

      await expect(page.locator('h1')).toContainText('E2E Portfolio', { timeout: 10_000 });
    });
  });

  // ─── Cash Transactions (via UI) ─────────────────────────────────

  test.describe('Cash Transactions', () => {
    test('create deposit via UI and verify it appears', async ({ page }) => {
      await page.goto(`/portfolios/${portfolioId}`);
      await page.waitForSelector('h1');

      await openCashTransactionDialog({ page });

      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('form')).toBeVisible({ timeout: 10_000 });

      // Deposit is the default PillTabs selection — no combobox pick needed
      await dialog.locator('input[type="number"]').fill('500');
      await pickDialogSelect({ page, nth: 0, optionName: CURRENCY });

      await dialog.locator('button[type="submit"]').click();
      await waitForSuccessToast({ page });

      const panel = await openActivity({ page, filter: 'cash' });
      await expect(panel.getByText(/\+\$500/)).toBeVisible({ timeout: 10_000 });
    });

    test('create withdrawal via UI and verify it appears', async ({ page }) => {
      await page.goto(`/portfolios/${portfolioId}`);
      await page.waitForSelector('h1');

      await openCashTransactionDialog({ page });

      const dialog = page.getByRole('dialog');
      // Select withdrawal via PillTabs button instead of combobox
      await dialog.getByRole('button', { name: /withdrawal/i }).click();
      await dialog.locator('input[type="number"]').fill('200');
      await pickDialogSelect({ page, nth: 0, optionName: CURRENCY });

      await dialog.locator('button[type="submit"]').click();
      await waitForSuccessToast({ page });

      const panel = await openActivity({ page, filter: 'cash' });
      await expect(panel.getByText(/-\$200/)).toBeVisible({ timeout: 10_000 });
    });

    test('delete cash transaction via UI', async ({ page }) => {
      await page.goto(`/portfolios/${portfolioId}`);
      await page.waitForSelector('h1');

      const panel = await openActivity({ page, filter: 'cash' });

      const deleteButtons = panel.getByRole('button', { name: /^delete$/i });
      await expect(deleteButtons.first()).toBeVisible({ timeout: 10_000 });

      const countBefore = await deleteButtons.count();

      await deleteButtons.first().click();

      const alertDialog = page.getByRole('alertdialog');
      await expect(alertDialog).toBeVisible({ timeout: 5_000 });

      await alertDialog
        .getByRole('button')
        .filter({ hasText: /delete/i })
        .click();

      await expect(alertDialog).not.toBeVisible({ timeout: 10_000 });
      await expect(deleteButtons).toHaveCount(countBefore - 1, { timeout: 10_000 });
    });
  });

  // ─── Buy/Sell via UI ────────────────────────────────────────────

  test.describe('Buy/Sell Transactions', () => {
    test('buy transaction via UI', async ({ page }) => {
      await page.goto(`/portfolios/${portfolioId}`);
      await page.waitForSelector('h1');

      await openHoldingTransactionDialog({ page });

      const numberInputs = page.getByRole('dialog').locator('input[type="number"]');
      await numberInputs.nth(0).fill('10'); // quantity
      await numberInputs.nth(1).fill('100'); // price
      await numberInputs.nth(2).fill('5'); // fees

      await page.getByRole('dialog').locator('button[type="submit"]').click();
      await waitForSuccessToast({ page });

      const panel = await openActivity({ page, filter: 'trades' });
      await expect(panel.getByRole('link', { name: /buy.*ETEST/i }).first()).toBeVisible({ timeout: 10_000 });
    });

    test('sell transaction via UI', async ({ page }) => {
      await page.goto(`/portfolios/${portfolioId}`);
      await page.waitForSelector('h1');

      await openHoldingTransactionDialog({ page });

      await pickDialogSelect({ page, nth: 0, optionName: /sell/i });

      const numberInputs = page.getByRole('dialog').locator('input[type="number"]');
      await numberInputs.nth(0).fill('5'); // quantity
      await numberInputs.nth(1).fill('120'); // price

      await page.getByRole('dialog').locator('button[type="submit"]').click();
      await waitForSuccessToast({ page });

      const panel = await openActivity({ page, filter: 'trades' });
      await expect(panel.getByRole('link', { name: /sell.*ETEST/i }).first()).toBeVisible({ timeout: 10_000 });
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────

  test.describe('Edge Cases', () => {
    test('empty portfolio shows empty cash transactions', async ({ page }) => {
      const emptyPRes = await apiPost({
        request: page.request,
        path: '/api/v1/investments/portfolios',
        data: { name: 'Empty Portfolio' },
      });
      const emptyPortfolioId = emptyPRes.response.id;

      await page.goto(`/portfolios/${emptyPortfolioId}`);
      await page.waitForSelector('h1');

      const panel = await openActivity({ page, filter: 'cash' });
      await expect(panel.getByRole('heading', { name: /nothing to show for this filter/i })).toBeVisible({
        timeout: 10_000,
      });
    });
  });
});
