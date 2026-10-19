import { test, expect, type Page } from '@playwright/test';

import { completeOnboarding, createAccount, createPortfolio, createTransaction } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';
import { pickDialogSelect } from '../../helpers/ui';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'a2p-mtx' });

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

  const p = await createPortfolio({ request, name: 'ManageTx Portfolio' });
  portfolio = { id: p.response.id, name: 'ManageTx Portfolio' };

  const acc = await createAccount({
    request,
    name: 'ManageTx Account',
    currencyCode: CURRENCY,
    initialBalance: 10000,
  });
  testAccount = { id: acc.response?.id ?? acc.id, name: 'ManageTx Account' };

  dataSeeded = true;
}

async function openCreateTransactionDialog({ page }: { page: Page }) {
  await page.getByRole('button', { name: /add transaction|new transaction/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  return dialog;
}

test.describe('Manage-transaction dialog: account-to-portfolio transfer', () => {
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

  test('destination-type toggle appears only on the Transfer tab', async ({ page }) => {
    const dialog = await openCreateTransactionDialog({ page });

    // Default tab is Expense — no pill toggle
    await expect(dialog.locator('button[data-value="portfolio"]')).not.toBeVisible();

    // Income tab — still no pill toggle
    await dialog.getByRole('button', { name: /select income/i }).click();
    await expect(dialog.locator('button[data-value="portfolio"]')).not.toBeVisible();

    // Transfer tab — toggle appears
    await dialog.getByRole('button', { name: /select transfer/i }).click();
    await expect(dialog.locator('button[data-value="account"]')).toBeVisible();
    await expect(dialog.locator('button[data-value="portfolio"]')).toBeVisible();
  });

  test('toggle swaps between account and portfolio destination selectors', async ({ page }) => {
    const dialog = await openCreateTransactionDialog({ page });

    await dialog.getByRole('button', { name: /select transfer/i }).click();

    // Default destination is account → "To Account" label visible
    await expect(dialog.getByText('To account', { exact: true })).toBeVisible();
    await expect(dialog.getByText('To portfolio', { exact: true })).not.toBeVisible();

    // Switch to portfolio
    await dialog.locator('button[data-value="portfolio"]').click();
    await expect(dialog.getByText('To portfolio', { exact: true })).toBeVisible();
    await expect(dialog.getByText('To account', { exact: true })).not.toBeVisible();

    // Switch back to account
    await dialog.locator('button[data-value="account"]').click();
    await expect(dialog.getByText('To account', { exact: true })).toBeVisible();
    await expect(dialog.getByText('To portfolio', { exact: true })).not.toBeVisible();
  });

  test('creates an account-to-portfolio transfer successfully', async ({ page }) => {
    const dialog = await openCreateTransactionDialog({ page });

    await dialog.getByRole('button', { name: /select transfer/i }).click();
    await dialog.locator('button[data-value="portfolio"]').click();

    // From Account (nth 0) and To Portfolio (nth 1)
    await pickDialogSelect({ page, nth: 0, optionName: testAccount.name });
    await pickDialogSelect({ page, nth: 1, optionName: portfolio.name });

    await dialog.locator('input[type="number"]').first().fill('250');
    await dialog.getByRole('button', { name: /create transaction/i }).click();

    // Dialog closes only when the mutation's onSuccess fires — proves creation succeeded
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  });

  test('converts an existing expense into a transfer to a portfolio', async ({ page }) => {
    // Seed an expense directly on the account so we can edit it
    await createTransaction({
      request: page.request,
      accountId: testAccount.id,
      amount: 75,
      transactionType: 'expense',
    });

    await page.goto(`/account/${testAccount.id}`);

    // Open the first expense in the list
    const txRecord = page.locator('[aria-haspopup="true"]').first();
    await expect(txRecord).toBeVisible({ timeout: 15_000 });
    await txRecord.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Flip to Transfer → Portfolio destination → pick the portfolio
    await dialog.getByRole('button', { name: /select transfer/i }).click();
    await dialog.locator('button[data-value="portfolio"]').click();
    await pickDialogSelect({ page, nth: 1, optionName: portfolio.name });

    // Submit the edit — this used to crash with `_isOutOfWallet` of null
    await dialog.getByRole('button', { name: /edit transaction/i }).click();

    // Dialog closes only when the mutation's onSuccess fires — proves link succeeded
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  });
});
