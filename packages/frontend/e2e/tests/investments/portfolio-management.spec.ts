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
  const etestRow = page.locator('table tbody tr').filter({ hasText: 'ETEST' }).first();
  await expect(etestRow).toBeVisible({ timeout: 10_000 });
  await etestRow.locator('button').first().click();

  const expandedArea = page
    .locator('table tbody tr')
    .filter({ has: page.locator('td[colspan]') })
    .first();
  await expect(expandedArea).toBeVisible({ timeout: 5_000 });

  const addTxBtn = expandedArea.getByRole('button').filter({ hasText: /add/i }).first();
  await addTxBtn.click();

  await expect(page.getByRole('dialog')).toBeVisible();
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

      await page.locator('button[data-value="cash-transactions"]').click();
      await expect(page.locator('text=/\\+\\$500/')).toBeVisible({ timeout: 10_000 });
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

      await page.locator('button[data-value="cash-transactions"]').click();
      await expect(page.locator('text=/-\\$200/')).toBeVisible({ timeout: 10_000 });
    });

    test('delete cash transaction via UI', async ({ page }) => {
      await page.goto(`/portfolios/${portfolioId}`);
      await page.waitForSelector('h1');

      await page.locator('button[data-value="cash-transactions"]').click();

      const cashTxContent = page.locator('.divide-y');
      const transactionRows = cashTxContent.locator('> div');
      await expect(transactionRows.first()).toBeVisible({ timeout: 10_000 });

      const countBefore = await transactionRows.count();

      const deleteBtn = transactionRows.first().locator('button').last();
      await deleteBtn.click();

      const alertDialog = page.getByRole('alertdialog');
      await expect(alertDialog).toBeVisible({ timeout: 5_000 });

      await alertDialog
        .getByRole('button')
        .filter({ hasText: /delete/i })
        .click();

      await expect(alertDialog).not.toBeVisible({ timeout: 10_000 });
      await expect(transactionRows).toHaveCount(countBefore - 1, { timeout: 10_000 });
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

      await page.locator('button[data-value="buys-sells"]').click();
      await expect(page.locator('text=/buy/i').first()).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('text=ETEST')).toBeVisible();
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

      await page.locator('button[data-value="buys-sells"]').click();
      await expect(page.locator('text=/sell/i').first()).toBeVisible({ timeout: 10_000 });
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

      await page.locator('button[data-value="cash-transactions"]').click();

      const emptyState = page.locator('text=/no.*transaction/i').or(page.locator('.text-muted-foreground.text-center'));
      await expect(emptyState.first()).toBeVisible({ timeout: 10_000 });
    });
  });
});
