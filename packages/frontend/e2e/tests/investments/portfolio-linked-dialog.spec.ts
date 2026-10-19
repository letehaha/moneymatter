import { test, expect } from '@playwright/test';

import {
  completeOnboarding,
  createAccount,
  createPortfolio,
  createTransaction,
  linkTransactionToPortfolio,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'pld' });

let portfolio: { id: string; name: string };
let testAccount: { id: string };
let linkedTxId: string;
let dataSeeded = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

async function seedTestData({ request }: { request: import('@playwright/test').APIRequestContext }): Promise<void> {
  if (dataSeeded) return;

  await completeOnboarding({ request, currencyCode: CURRENCY });

  const p = await createPortfolio({ request, name: 'Test Portfolio' });
  portfolio = { id: p.response.id, name: 'Test Portfolio' };

  const acc = await createAccount({
    request,
    name: 'Main Account',
    currencyCode: CURRENCY,
    initialBalance: 10000,
  });
  testAccount = { id: acc.response?.id ?? acc.id };

  const tx = await createTransaction({
    request,
    accountId: testAccount.id,
    amount: 500,
    transactionType: 'expense',
  });
  linkedTxId = (Array.isArray(tx.response) ? tx.response[0]?.id : tx.response?.id) ?? tx.id;

  await linkTransactionToPortfolio({
    request,
    transactionId: linkedTxId,
    portfolioId: portfolio.id,
  });

  dataSeeded = true;
}

test.describe('Portfolio-Linked Transaction Dialog', () => {
  test.use({
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    await seedTestData({ request: page.request });
  });

  test('opens portfolio-linked view instead of edit form when clicking a linked transaction', async ({ page }) => {
    await page.goto('/transactions');
    await page.waitForURL(/\/transactions/, { timeout: 15_000 });

    // Wait for transactions to load
    const txRecord = page.locator('[aria-haspopup="true"]').first();
    await expect(txRecord).toBeVisible({ timeout: 10_000 });
    await txRecord.click();

    // The dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // It should show the portfolio-linked title, NOT the edit form title
    await expect(dialog.getByText('Portfolio-Linked Transaction')).toBeVisible({ timeout: 5_000 });

    // Should show linked-as info with portfolio name as a link
    await expect(dialog.getByRole('link', { name: portfolio.name })).toBeVisible();

    // Should show the unlink button
    await expect(dialog.getByRole('button', { name: /unlink from portfolio/i })).toBeVisible();

    // Should NOT show the regular edit form elements
    await expect(dialog.locator('text=Amount')).not.toBeVisible();
  });
});
