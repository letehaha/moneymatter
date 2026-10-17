import { type APIRequestContext, type Locator, type Page, expect, test } from '@playwright/test';

import {
  completeOnboarding,
  createAccount,
  createTransaction,
  extractId,
  signInViaApi,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';
import { waitForSuccessToast } from '../../helpers/ui';

const BASE_CURRENCY = 'USD';
const CODE = 'USDT';
const NAME = 'Tether';
const DECIMALS = 6;
const ACCOUNT_NAME = 'Tether Wallet';
const AMOUNT = 12.345678;
const FORMATTED_AMOUNT = '12.345678 USDT';
const creds = buildTestCredentials({ prefix: 'customccy' });

test.describe.configure({ mode: 'serial' });

const dialogField = ({ page, testId }: { page: Page; testId: string }): Locator =>
  page.getByRole('dialog').locator(`input[data-testid="${testId}"], [data-testid="${testId}"] input`).first();

test.describe('Custom currencies', () => {
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    api = await signInViaApi({ playwright, email: creds.email, password: creds.password });
    await completeOnboarding({ request: api, currencyCode: BASE_CURRENCY });
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
  });

  test('creates a USDT currency from the currencies settings', async ({ page }) => {
    await page.goto('/settings/currencies');

    await page.getByTestId('add-custom-currency').click();
    await dialogField({ page, testId: 'custom-currency-code' }).fill('usdt');
    await dialogField({ page, testId: 'custom-currency-name' }).fill(NAME);
    await dialogField({ page, testId: 'custom-currency-decimals' }).fill(String(DECIMALS));

    await expect(page.getByTestId('custom-currency-preview')).toHaveText('Example: 1,234.500000 USDT');

    await page.getByTestId('custom-currency-submit').click();
    await waitForSuccessToast({ page });

    const row = page.getByRole('button', { name: new RegExp(NAME) });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('custom-currency-badge')).toBeVisible();
  });

  test('a transaction in it shows 6 decimals and the missing-rate badge until a rate exists', async ({ page }) => {
    const accountId = extractId(
      await createAccount({ request: api, name: ACCOUNT_NAME, currencyCode: CODE, initialBalance: 0 }),
    );
    await createTransaction({ request: api, accountId, amount: AMOUNT, transactionType: 'expense' });

    await page.goto('/transactions');

    // The user has no USDT rate, so the entry is saved with its native amount and no base-currency amount.
    await expect(page.getByText(FORMATTED_AMOUNT).first()).toBeVisible();
    await expect(page.getByTestId('missing-rate-badge').first()).toBeVisible();
  });

  test('the decimals are locked while an account holds the currency', async ({ page }) => {
    await page.goto('/settings/currencies');

    await page.getByRole('button', { name: new RegExp(NAME) }).click();
    await page.getByTestId('edit-custom-currency').click();

    await expect(dialogField({ page, testId: 'custom-currency-decimals' })).toBeDisabled();
    await expect(page.getByTestId('custom-currency-decimals-hint')).toContainText(
      'Decimals can change only while no account, transaction or template uses USDT',
    );
  });

  test('pegging USDT to USD removes the missing-rate badge and values the transaction in the base currency', async ({
    page,
  }) => {
    await page.goto('/settings/currencies');

    await page.getByRole('button', { name: new RegExp(NAME) }).click();
    await page.getByTestId('rate-source-tabs').locator('[data-value="peg"]').click();

    await page.getByTestId('rate-source-peg-currency').locator('button[role="combobox"]').click();
    await page.getByRole('option', { name: /^USD ·/ }).click();
    await page.locator('input[data-testid="rate-source-peg-factor"]').fill('1');
    await page.getByTestId('rate-source-save').click();
    await waitForSuccessToast({ page });

    await page.goto('/transactions');

    // 12.345678 USDT at a 1:1 peg is 12.35 in the USD base currency.
    await expect(page.getByText(FORMATTED_AMOUNT).first()).toBeVisible();
    await expect(page.getByTestId('missing-rate-badge')).toHaveCount(0);
    await expect(page.getByText(/12\.35/).first()).toBeVisible();
  });
});
