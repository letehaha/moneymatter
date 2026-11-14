import { test, expect, type Page } from '@playwright/test';

import { completeOnboarding, createAccount, createTransaction, extractId } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'tf' });

let accountId: string;
let dataSeeded = false;

// Filters auto-apply 400 ms after the last edit; allow some headroom for the
// debounce + refetch + virtualizer re-render before asserting row counts.
const FILTER_APPLY_DEBOUNCE_MS = 400;
const FILTER_APPLY_WAIT_MS = FILTER_APPLY_DEBOUNCE_MS + 400;

const tableRows = (page: Page) => page.locator('tbody tr[aria-haspopup="true"]');

// Drop every chip from the filter bar and reset the always-visible filters to
// their default values. The picker popover keeps the same set of options on
// every visit and marks active ones with a check icon, so we open it once and
// click the first checked row until none remain.
async function clearAllExtraFilters({ page }: { page: Page }) {
  const resetButton = page.getByRole('button', { name: /^Reset$/ });
  if (await resetButton.isEnabled()) {
    await resetButton.click();
  }

  await page.getByRole('button', { name: /^Filters$/ }).click();

  const activeOption = page
    .locator('div[data-state="open"] button')
    .filter({ has: page.locator('svg.lucide-check') })
    .first();

  while (await activeOption.isVisible().catch(() => false)) {
    await activeOption.click();
    await page.waitForTimeout(50);
  }

  await page.keyboard.press('Escape');
}

// Opens the "Filters" popover menu and clicks the row with the given label,
// which adds the corresponding chip to the toolbar.
async function addExtraFilter({ page, label }: { page: Page; label: string }) {
  await page.getByRole('button', { name: /^Filters$/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${label}$`) }).click();
  await page.keyboard.press('Escape');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

test.describe('Transactions filters (desktop)', () => {
  test.use({
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Wide viewport keeps /transactions in the desktop table view. The page
    // measures its own container (not the viewport) and falls back to the
    // mobile layout below 672 px of content width; 1440 sits comfortably above.
    viewport: { width: 1440, height: 900 },
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });

    if (!dataSeeded) {
      await completeOnboarding({ request: page.request, currencyCode: CURRENCY });

      const account = await createAccount({
        request: page.request,
        name: 'Filter Test Account',
        currencyCode: CURRENCY,
        initialBalance: 100000,
      });
      accountId = extractId(account);

      // Three expenses (low amounts) and three incomes (high amounts) with
      // distinct notes — covers the Type, Amount and search assertions
      // without overlap.
      await createTransaction({
        request: page.request,
        accountId,
        amount: 12,
        transactionType: 'expense',
        note: 'Coffee at Starbucks',
      });
      await createTransaction({
        request: page.request,
        accountId,
        amount: 25,
        transactionType: 'expense',
        note: 'Lunch sandwich',
      });
      await createTransaction({
        request: page.request,
        accountId,
        amount: 80,
        transactionType: 'expense',
        note: 'Books from Amazon',
      });
      await createTransaction({
        request: page.request,
        accountId,
        amount: 500,
        transactionType: 'income',
        note: 'Monthly salary',
      });
      await createTransaction({
        request: page.request,
        accountId,
        amount: 200,
        transactionType: 'income',
        note: 'Freelance gig',
      });
      await createTransaction({
        request: page.request,
        accountId,
        amount: 150,
        transactionType: 'income',
        note: 'Refund from Amazon',
      });

      dataSeeded = true;
    }

    await page.goto('/transactions');
    await page.waitForURL(/\/transactions/, { timeout: 15_000 });

    // Wait for at least one row before any filter-bar interaction — the table
    // is virtualized and the toolbar's Reset button can briefly be disabled
    // until the first batch lands.
    await expect(tableRows(page).first()).toBeVisible({ timeout: 15_000 });

    await clearAllExtraFilters({ page });
  });

  test('adds the Type filter and narrows the table to expenses', async ({ page }) => {
    expect(await tableRows(page).count()).toBe(6);

    await addExtraFilter({ page, label: 'Type' });

    // The new chip surfaces a "Transaction type" select with "All types" as
    // the initial value — locate the trigger by its visible label so we don't
    // collide with the always-visible accounts/categories pickers.
    const typeTrigger = page.locator('button').filter({ hasText: 'All types' });
    await expect(typeTrigger).toBeVisible();
    await typeTrigger.click();

    await page.getByRole('option', { name: 'Expense' }).click();

    await page.waitForTimeout(FILTER_APPLY_WAIT_MS);
    await expect(tableRows(page)).toHaveCount(3);

    // Reset clears the value (the chip itself stays, persisted in user settings).
    await page.getByRole('button', { name: /^Reset$/ }).click();
    await expect(tableRows(page)).toHaveCount(6);
  });

  test('adds the Amount filter and narrows the table by min amount', async ({ page }) => {
    await addExtraFilter({ page, label: 'Amount range' });

    // Compact placeholders from `amountRange.compactFrom/compactTo`.
    await page.locator('input[placeholder="Min amount"]').fill('100');

    await page.waitForTimeout(FILTER_APPLY_WAIT_MS);
    // Three incomes are >= 100 (500, 200, 150); all expenses are below.
    await expect(tableRows(page)).toHaveCount(3);

    // Tighten with a max — only the 150 and 200 incomes should remain.
    await page.locator('input[placeholder="Max amount"]').fill('300');

    await page.waitForTimeout(FILTER_APPLY_WAIT_MS);
    await expect(tableRows(page)).toHaveCount(2);

    await page.getByRole('button', { name: /^Reset$/ }).click();
    await expect(tableRows(page)).toHaveCount(6);
  });

  test('narrows the table by the search box text', async ({ page }) => {
    await page.getByRole('searchbox').fill('amazon');

    await page.waitForTimeout(FILTER_APPLY_WAIT_MS);
    // "Books from Amazon" + "Refund from Amazon" — case-insensitive match.
    await expect(tableRows(page)).toHaveCount(2);

    await page.getByRole('button', { name: /^Reset$/ }).click();
    await expect(tableRows(page)).toHaveCount(6);
  });

  test('removes an extra filter via its X button and restores the chip on next add', async ({ page }) => {
    await addExtraFilter({ page, label: 'Amount range' });
    const minAmountInput = page.locator('input[placeholder="Min amount"]');
    await expect(minAmountInput).toBeVisible();

    // Apply a narrowing value first so we can prove the X button both removes
    // the chip and clears the filter value.
    await minAmountInput.fill('300');
    await page.waitForTimeout(FILTER_APPLY_WAIT_MS);
    await expect(tableRows(page)).toHaveCount(1);

    // Only one chip is on screen, so the single "Remove filter" button is unambiguous.
    await page.getByRole('button', { name: 'Remove filter' }).click();

    await expect(minAmountInput).toHaveCount(0);
    await page.waitForTimeout(FILTER_APPLY_WAIT_MS);
    await expect(tableRows(page)).toHaveCount(6);
  });

  test('combines two extra filters at once', async ({ page }) => {
    await addExtraFilter({ page, label: 'Type' });
    await addExtraFilter({ page, label: 'Amount range' });

    await page.locator('button').filter({ hasText: 'All types' }).click();
    await page.getByRole('option', { name: 'Income' }).click();

    await page.locator('input[placeholder="Min amount"]').fill('200');

    await page.waitForTimeout(FILTER_APPLY_WAIT_MS);
    // Incomes only (3) AND amount >= 200 → 500 and 200, so 2 rows.
    await expect(tableRows(page)).toHaveCount(2);

    await page.getByRole('button', { name: /^Reset$/ }).click();
    await expect(tableRows(page)).toHaveCount(6);
  });
});
