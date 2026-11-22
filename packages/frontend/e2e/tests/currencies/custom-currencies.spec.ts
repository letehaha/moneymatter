import { type APIRequestContext, type Locator, type Page, expect, test } from '@playwright/test';

import {
  apiPut,
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
const RATE = '1.5';
const ACCOUNT_NAME = 'Tether Wallet';
const AMOUNT = 12.345678;
const SHORTENED_AMOUNT = '12.35 USDT';
const FULL_AMOUNT = '12.345678 USDT';
const DAY_MS = 24 * 60 * 60 * 1000;
const creds = buildTestCredentials({ prefix: 'customccy' });

test.describe.configure({ mode: 'serial' });

const dialogField = ({ page, testId }: { page: Page; testId: string }): Locator =>
  page.getByRole('dialog').locator(`input[data-testid="${testId}"], [data-testid="${testId}"] input`).first();

const daysAgo = ({ days }: { days: number }): string => new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

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

  test('creates a USDT currency with its rate from the currencies settings', async ({ page }) => {
    await page.goto('/settings/currencies');

    await page.getByTestId('add-custom-currency').click();
    await dialogField({ page, testId: 'custom-currency-code' }).fill('usdt');
    await dialogField({ page, testId: 'custom-currency-name' }).fill(NAME);
    await dialogField({ page, testId: 'custom-currency-decimals' }).fill(String(DECIMALS));
    await dialogField({ page, testId: 'custom-currency-rate' }).fill(RATE);

    await expect(page.getByTestId('custom-currency-preview')).toHaveText('Example: 1,234.500000 USDT');

    await page.getByTestId('custom-currency-submit').click();
    await waitForSuccessToast({ page });

    const row = page.getByRole('button', { name: new RegExp(NAME) });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('custom-currency-badge')).toBeVisible();
    await expect(row).toContainText(`1 ${CODE} = ${RATE} ${BASE_CURRENCY}`);
  });

  test('a transaction in it shows a shortened amount with all 6 decimals in a tooltip', async ({ page }) => {
    const accountId = extractId(
      await createAccount({ request: api, name: ACCOUNT_NAME, currencyCode: CODE, initialBalance: 0 }),
    );
    await createTransaction({ request: api, accountId, amount: AMOUNT, transactionType: 'expense' });

    await page.goto('/transactions');

    const shortened = page.getByRole('row').getByText(SHORTENED_AMOUNT).first();
    await expect(shortened).toBeVisible();

    await shortened.hover();
    await expect(page.getByText(FULL_AMOUNT)).toBeVisible();
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

  test('pegging USDT to USD values the transaction in the base currency', async ({ page }) => {
    await page.goto('/settings/currencies');

    await page.getByRole('button', { name: new RegExp(NAME) }).click();
    await page.getByTestId('source-summary-change').click();
    await page.getByTestId('rate-source-radio-peg').click();

    await page.getByTestId('rate-source-peg-currency').locator('button[role="combobox"]').click();
    await page.getByRole('option', { name: /^USD ·/ }).click();
    await page.locator('input[data-testid="rate-source-peg-factor"]').fill('1');
    await page.getByTestId('rate-source-save').click();
    await waitForSuccessToast({ page });

    await page.goto('/transactions');

    // 12.345678 USDT at a 1:1 peg is 12.35 in the USD base currency.
    await expect(page.getByRole('row').getByText(SHORTENED_AMOUNT).first()).toBeVisible();
    await expect(page.getByText(/12\.35/).first()).toBeVisible();
  });

  test('the rate history lists dated rates latest first, and a rate can be edited and removed', async ({ page }) => {
    const [olderDay, newerDay] = [daysAgo({ days: 10 }), daysAgo({ days: 5 })];

    // The peg kept from the previous case overrides stored rates, so the currency goes back to manual first.
    await page.goto('/settings/currencies');
    await page.getByRole('button', { name: new RegExp(NAME) }).click();
    await page.getByTestId('source-summary-change').click();
    await page.getByTestId('rate-source-radio-manual').click();
    await page.getByTestId('rate-source-save').click();
    await waitForSuccessToast({ page });

    for (const [effectiveDate, rate] of [
      [olderDay, 2],
      [newerDay, 4],
    ] as const) {
      await apiPut({
        request: api,
        path: '/api/v1/user/currency/rates',
        data: {
          pairs: [
            { baseCode: CODE, quoteCode: BASE_CURRENCY, rate, effectiveDate },
            { baseCode: BASE_CURRENCY, quoteCode: CODE, rate: 1 / rate, effectiveDate },
          ],
        },
      });
    }

    await page.reload();
    await page.getByRole('button', { name: new RegExp(NAME) }).click();

    // The rate given at creation starts today, so it is the latest one and in force. With three rates the
    // overview's recent list shows them all.
    const rows = page.getByTestId('rate-history-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first().getByTestId('rate-history-rate')).toHaveText(`1 USDT = ${RATE} USD`);
    await expect(rows.first().getByTestId('rate-history-in-force')).toBeVisible();
    await expect(rows.nth(1).getByTestId('rate-history-rate')).toHaveText('1 USDT = 4 USD');
    await expect(rows.last().getByTestId('rate-history-rate')).toHaveText('1 USDT = 2 USD');

    const editDialog = page.getByRole('dialog').filter({ has: page.getByTestId('edit-dated-rate') });

    await rows.nth(1).getByTestId('rate-history-edit').click();
    await editDialog.locator('input[data-testid="manual-rate-base"], [data-testid="manual-rate-base"] input').fill('5');
    await editDialog.getByTestId('manual-rate-save').click();
    await waitForSuccessToast({ page });
    await expect(rows.nth(1).getByTestId('rate-history-rate')).toHaveText('1 USDT = 5 USD');
    await expect(rows).toHaveCount(3);

    await rows.last().getByTestId('rate-history-edit').click();
    await editDialog.getByTestId('rate-form-remove').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove rate' }).click();
    await waitForSuccessToast({ page });
    await expect(rows).toHaveCount(2);
    await expect(rows.last().getByTestId('rate-history-rate')).toHaveText('1 USDT = 5 USD');
  });
});
