import { test, expect } from '@playwright/test';

import {
  completeOnboarding,
  createAccount,
  createPortfolio,
  createTransaction,
  setPortfolioCash,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';
import { pickDialogSelect } from '../../helpers/ui';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'tpl' });

let portfolio: { id: string; name: string };
let testAccount: { id: string; name: string };
let dataSeeded = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

async function seedTestData({ request }: { request: import('@playwright/test').APIRequestContext }): Promise<void> {
  if (dataSeeded) return;

  await completeOnboarding({ request, currencyCode: CURRENCY });

  const p = await createPortfolio({ request, name: 'Link Test Portfolio' });
  portfolio = { id: p.response.id, name: 'Link Test Portfolio' };

  await setPortfolioCash({ request, portfolioId: portfolio.id, currencyCode: CURRENCY, amount: '5000' });

  const acc = await createAccount({
    request,
    name: 'Link Test Account',
    currencyCode: CURRENCY,
    initialBalance: 10000,
  });
  testAccount = { id: acc.response?.id ?? acc.id, name: 'Link Test Account' };

  await createTransaction({
    request,
    accountId: testAccount.id,
    amount: 250,
    transactionType: 'income',
  });

  await createTransaction({
    request,
    accountId: testAccount.id,
    amount: 150,
    transactionType: 'expense',
  });

  dataSeeded = true;
}

// ─── UI helpers specific to this suite ───────────────────────────────

async function openTransferDialogOnPortfolio({ page }: { page: import('@playwright/test').Page }): Promise<void> {
  await page.goto(`/portfolios/${portfolio.id}`);
  await page.waitForSelector('h1');

  // Click "Add Cash Transaction" button to open the dialog
  await page.getByRole('button', { name: /add cash transaction/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const dialog = page.getByRole('dialog');

  // Select "Withdrawal" outer tab, then "Transfer" inner tab
  await dialog.getByRole('button', { name: /withdrawal/i }).click();
  await dialog.getByRole('button', { name: /transfer/i }).click();
}

async function linkExistingTransaction({ page }: { page: import('@playwright/test').Page }): Promise<void> {
  // Click "Link existing transaction" button which opens the picker dialog
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /link existing transaction/i })
    .click();

  // Wait for the picker dialog to appear
  const pickerDialog = page.getByRole('dialog').last();
  await expect(pickerDialog).toBeVisible({ timeout: 10_000 });

  // Click first transaction record in the picker to select it
  const firstRecord = pickerDialog.locator('[aria-haspopup="true"]').first();
  await expect(firstRecord).toBeVisible({ timeout: 10_000 });
  await firstRecord.click();
}

async function submitTransferAndConfirm({
  page,
  submitLabel = /submit/i,
}: {
  page: import('@playwright/test').Page;
  submitLabel?: RegExp;
}): Promise<void> {
  const dialog = page.getByRole('dialog');

  const submitBtn = dialog.getByRole('button', { name: submitLabel });
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();

  await expect(page.getByRole('button', { name: /confirm/i })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /confirm/i }).click();

  // Wait for the main dialog to close (indicates success)
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('Transaction-Portfolio Linking via Transfer Form', () => {
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

  test('portfolio-to-account: link existing income transaction', async ({ page }) => {
    await openTransferDialogOnPortfolio({ page });

    // Link an existing transaction (opens picker, selects first tx)
    await linkExistingTransaction({ page });

    // Verify the picked transaction is displayed (the X clear button should be visible)
    const clearBtn = page
      .getByRole('dialog')
      .first()
      .locator('button')
      .filter({ has: page.locator('svg') })
      .last();
    await expect(clearBtn).toBeVisible();

    // Submit
    await submitTransferAndConfirm({ page });
  });

  test('account-to-portfolio: link existing expense transaction', async ({ page }) => {
    // Navigate to account page
    await page.goto(`/account/${testAccount.id}`);

    const transferBtn = page.getByRole('button', { name: /transfer to portfolio/i });
    await expect(transferBtn).toBeVisible({ timeout: 15_000 });
    await transferBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Select target portfolio
    await pickDialogSelect({ page, nth: 2, optionName: portfolio.name });

    // Link an existing transaction (opens picker, selects first tx)
    await linkExistingTransaction({ page });

    // Submit (account page uses PortfolioTransferForm with "Transfer" button)
    await submitTransferAndConfirm({ page, submitLabel: /transfer/i });
  });
});
