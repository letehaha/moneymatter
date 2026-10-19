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
const creds = buildTestCredentials({ prefix: 'pct' });

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

  const p = await createPortfolio({ request, name: 'Cash Tx Portfolio' });
  portfolio = { id: p.response.id, name: 'Cash Tx Portfolio' };

  await setPortfolioCash({ request, portfolioId: portfolio.id, currencyCode: CURRENCY, amount: '10000' });

  const acc = await createAccount({
    request,
    name: 'Cash Tx Account',
    currencyCode: CURRENCY,
    initialBalance: 20000,
  });
  testAccount = { id: acc.response?.id ?? acc.id, name: 'Cash Tx Account' };

  await createTransaction({
    request,
    accountId: testAccount.id,
    amount: 300,
    transactionType: 'expense',
  });

  await createTransaction({
    request,
    accountId: testAccount.id,
    amount: 500,
    transactionType: 'income',
  });

  dataSeeded = true;
}

// ─── UI helpers ──────────────────────────────────────────────────────

async function openCashDialog({ page }: { page: import('@playwright/test').Page }): Promise<void> {
  await page.goto(`/portfolios/${portfolio.id}`);
  await page.waitForSelector('h1');

  await page.getByRole('button', { name: /add cash transaction/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function selectOuterTab({
  page,
  tab,
}: {
  page: import('@playwright/test').Page;
  tab: 'deposit' | 'withdrawal';
}): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: new RegExp(tab, 'i') }).click();
}

async function selectInnerTab({
  page,
  tab,
}: {
  page: import('@playwright/test').Page;
  tab: 'direct' | 'transfer';
}): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: new RegExp(tab, 'i') }).click();
}

async function fillDirectForm({
  page,
  amount,
}: {
  page: import('@playwright/test').Page;
  amount: string;
}): Promise<void> {
  const dialog = page.getByRole('dialog');

  await dialog.locator('input[type="number"]').fill(amount);

  // Select currency (first combobox in the dialog)
  await pickDialogSelect({ page, nth: 0, optionName: CURRENCY });
}

async function fillTransferFormManual({
  page,
  amount,
  selectCurrency,
}: {
  page: import('@playwright/test').Page;
  amount: string;
  selectCurrency?: boolean;
}): Promise<void> {
  const dialog = page.getByRole('dialog');

  // Select account (first combobox in transfer mode)
  await pickDialogSelect({ page, nth: 0, optionName: testAccount.name });

  await dialog.locator('input[type="number"]').fill(amount);

  // For withdrawal+transfer, also select currency (second combobox)
  if (selectCurrency) {
    await pickDialogSelect({ page, nth: 1, optionName: CURRENCY });
  }
}

async function linkExistingTransaction({ page }: { page: import('@playwright/test').Page }): Promise<void> {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /link existing transaction/i })
    .click();

  const pickerDialog = page.getByRole('dialog').last();
  await expect(pickerDialog).toBeVisible({ timeout: 10_000 });

  const firstRecord = pickerDialog.locator('[aria-haspopup="true"]').first();
  await expect(firstRecord).toBeVisible({ timeout: 10_000 });
  await firstRecord.click();
}

async function submitForm({ page }: { page: import('@playwright/test').Page }): Promise<void> {
  const dialog = page.getByRole('dialog');

  const submitBtn = dialog.getByRole('button', { name: /submit/i });
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();
}

async function confirmAndWait({ page }: { page: import('@playwright/test').Page }): Promise<void> {
  await expect(page.getByRole('button', { name: /confirm/i })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /confirm/i }).click();

  // Wait for the main dialog to close (indicates success)
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('Portfolio Cash Transactions – All 6 Submit Paths', () => {
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

  test('1. Direct deposit', async ({ page }) => {
    await openCashDialog({ page });
    // Deposit + Direct is the default

    await fillDirectForm({ page, amount: '100' });
    await submitForm({ page });

    // Direct mode submits immediately without confirmation — dialog closes on success
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
  });

  test('2. Direct withdrawal', async ({ page }) => {
    await openCashDialog({ page });
    await selectOuterTab({ page, tab: 'withdrawal' });

    await fillDirectForm({ page, amount: '50' });
    await submitForm({ page });

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
  });

  test('3. Transfer deposit – manual', async ({ page }) => {
    await openCashDialog({ page });
    // Deposit is default, switch to Transfer
    await selectInnerTab({ page, tab: 'transfer' });

    await fillTransferFormManual({ page, amount: '200' });
    await submitForm({ page });
    await confirmAndWait({ page });
  });

  test('4. Transfer withdrawal – manual', async ({ page }) => {
    await openCashDialog({ page });
    await selectOuterTab({ page, tab: 'withdrawal' });
    await selectInnerTab({ page, tab: 'transfer' });

    await fillTransferFormManual({ page, amount: '150', selectCurrency: true });
    await submitForm({ page });
    await confirmAndWait({ page });
  });

  test('5. Transfer deposit – link transaction', async ({ page }) => {
    await openCashDialog({ page });
    await selectInnerTab({ page, tab: 'transfer' });

    // Deposit links expense transactions
    await linkExistingTransaction({ page });

    // Verify linked tx is displayed (X clear button visible)
    const clearBtn = page
      .getByRole('dialog')
      .first()
      .locator('button')
      .filter({ has: page.locator('svg') })
      .last();
    await expect(clearBtn).toBeVisible();

    await submitForm({ page });
    await confirmAndWait({ page });
  });

  test('6. Transfer withdrawal – link transaction', async ({ page }) => {
    await openCashDialog({ page });
    await selectOuterTab({ page, tab: 'withdrawal' });
    await selectInnerTab({ page, tab: 'transfer' });

    // Withdrawal links income transactions
    await linkExistingTransaction({ page });

    const clearBtn = page
      .getByRole('dialog')
      .first()
      .locator('button')
      .filter({ has: page.locator('svg') })
      .last();
    await expect(clearBtn).toBeVisible();

    await submitForm({ page });
    await confirmAndWait({ page });
  });
});
