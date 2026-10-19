import { test, expect, type Page, type APIRequestContext, type Locator } from '@playwright/test';

import {
  addUserCurrencies,
  completeOnboarding,
  createHolding,
  createInvestmentTransaction,
  createPortfolio,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';
import { waitForSuccessToast } from '../../helpers/ui';

const HOLDING_CURRENCY = 'USD';
const SETTLEMENT_CURRENCY = 'PLN';
const creds = buildTestCredentials({ prefix: 'sc' });

let portfolioId: string;
let dataSeeded = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

async function seedTestData({ request }: { request: APIRequestContext }): Promise<void> {
  if (dataSeeded) return;

  await completeOnboarding({ request, currencyCode: HOLDING_CURRENCY });
  await addUserCurrencies({ request, currencyCode: SETTLEMENT_CURRENCY });

  const pRes = await createPortfolio({ request, name: 'Settlement E2E Portfolio' });
  portfolioId = pRes.response.id;

  const holdingRes = await createHolding({
    request,
    portfolioId,
    symbol: 'ETEST',
    currencyCode: HOLDING_CURRENCY,
  });

  // Seed a buy tx so the holding row isn't collapsed under "Closed positions"
  // — the holdings table hides zero-quantity rows under that group.
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

// ─── UI helpers ──────────────────────────────────────────────────────

async function openHoldingTransactionDialog({ page }: { page: Page }): Promise<void> {
  const etestRow = page.locator('table tbody tr').filter({ hasText: 'ETEST' }).first();
  await expect(etestRow).toBeVisible({ timeout: 10_000 });
  await etestRow.locator('button').first().click();

  const expandedArea = page
    .locator('table tbody tr')
    .filter({ has: page.locator('td[colspan]') })
    .first();
  await expect(expandedArea).toBeVisible({ timeout: 5_000 });

  await expandedArea.getByRole('button').filter({ hasText: /add/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function fillCoreFields({
  page,
  quantity,
  price,
}: {
  page: Page;
  quantity: string;
  price: string;
}): Promise<void> {
  const numberInputs = page.getByRole('dialog').locator('input[type="number"]');
  await numberInputs.nth(0).fill(quantity);
  await numberInputs.nth(1).fill(price);
}

async function enableSettlement({ page }: { page: Page }): Promise<void> {
  await page
    .getByRole('dialog')
    .getByText(/specify actual cash amount/i)
    .click();
}

/**
 * Picks a settlement currency via the in-dropdown search input. The PLN entry
 * is below the visible viewport, so typing into the search avoids a fragile
 * scroll-into-view.
 */
async function pickSettlementCurrency({ page, code }: { page: Page; code: string }): Promise<void> {
  const dialog = page.getByRole('dialog');
  // The settlement currency combobox is the second one in the dialog
  // (type select is index 0). The security select is hidden because
  // the dialog is opened from a specific holding row.
  await dialog.locator('button[role="combobox"]').nth(1).click();

  const searchInput = page.getByPlaceholder('Search...').last();
  await expect(searchInput).toBeVisible({ timeout: 5_000 });
  await searchInput.fill(code);

  await page
    .getByRole('option', { name: new RegExp(code, 'i') })
    .first()
    .click();
}

async function submit({ page }: { page: Page }): Promise<void> {
  await page.getByRole('dialog').locator('button[type="submit"]').click();
}

function dialogNumberInputs({ page }: { page: Page }): Locator {
  return page.getByRole('dialog').locator('input[type="number"]');
}

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('Investment Transaction – Settlement Currency', () => {
  test.use({
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    await seedTestData({ request: page.request });

    await page.goto(`/portfolios/${portfolioId}`);
    await page.waitForSelector('h1');
  });

  test('toggle expands settlement card and defaults currency to security currency', async ({ page }) => {
    await openHoldingTransactionDialog({ page });

    const dialog = page.getByRole('dialog');

    // Settlement card is collapsed → no currency combobox yet
    await expect(dialog.locator('button[role="combobox"]')).toHaveCount(1);

    await enableSettlement({ page });

    // Settlement currency combobox shows up and defaults to the holding currency
    const currencyTrigger = dialog.locator('button[role="combobox"]').nth(1);
    await expect(currencyTrigger).toBeVisible();
    await expect(currencyTrigger).toContainText(HOLDING_CURRENCY);

    // Same-currency mode: no PillTabs (fee/auto/rate) and no preview box yet
    await expect(dialog.locator('[data-test="settlement-preview-box"]')).toHaveCount(0);
  });

  test('same-currency settlement: cash amount derives fee and submits', async ({ page }) => {
    await openHoldingTransactionDialog({ page });
    await fillCoreFields({ page, quantity: '5', price: '100' });
    await enableSettlement({ page });

    // 5 × 100 = 500 notional; user spent 510 → fee = 10 (derived server-side)
    await dialogNumberInputs({ page }).nth(2).fill('510');

    await submit({ page });
    await waitForSuccessToast({ page });
  });

  test('cross-currency fee mode: explicit fee submits and previews the rate', async ({ page }) => {
    await openHoldingTransactionDialog({ page });
    await fillCoreFields({ page, quantity: '10', price: '100' });
    await enableSettlement({ page });

    await pickSettlementCurrency({ page, code: SETTLEMENT_CURRENCY });

    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-test="settlement-preview-box"]')).toBeVisible();

    // 10 × 100 USD = 1000 notional; 3505 PLN paid, fee = 5 PLN
    // → rate = (3505 - 5) / 1000 = 3.5
    await dialogNumberInputs({ page }).nth(2).fill('3505'); // settlementAmount
    await dialogNumberInputs({ page }).nth(3).fill('5'); // settlementFees (fee mode is default)

    const preview = dialog.locator('[data-test="settlement-preview"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('3.5000');

    await submit({ page });
    await waitForSuccessToast({ page });
  });

  test('cross-currency rate mode: explicit rate submits and previews the fee', async ({ page }) => {
    await openHoldingTransactionDialog({ page });
    await fillCoreFields({ page, quantity: '10', price: '100' });
    await enableSettlement({ page });

    await pickSettlementCurrency({ page, code: SETTLEMENT_CURRENCY });

    const dialog = page.getByRole('dialog');
    // Switch from fee mode to rate mode via PillTabs
    await dialog.getByRole('button', { name: /rate/i }).first().click();

    // 10 × 100 USD = 1000 notional, rate 3.5 USD→PLN, cash 3505 PLN
    // → fee = 3505 - 1000 × 3.5 = 5 PLN
    await dialogNumberInputs({ page }).nth(2).fill('3505'); // settlementAmount
    await dialogNumberInputs({ page }).nth(3).fill('3.5'); // settlementRate

    const preview = dialog.locator('[data-test="settlement-preview"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('5.00');
    await expect(preview).toContainText('3.5000');

    await submit({ page });
    await waitForSuccessToast({ page });
  });

  test('settlement currency dropdown filters options via the search field', async ({ page }) => {
    await openHoldingTransactionDialog({ page });
    await enableSettlement({ page });

    const dialog = page.getByRole('dialog');
    await dialog.locator('button[role="combobox"]').nth(1).click();

    const searchInput = page.getByPlaceholder('Search...').last();
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Unfiltered: many currencies in the system list
    const countBefore = await page.getByRole('option').count();
    expect(countBefore).toBeGreaterThan(10);

    await searchInput.fill('PLN');

    // Debounced filter (300ms): wait for the count to drop to a small set
    await expect.poll(() => page.getByRole('option').count(), { timeout: 3_000 }).toBeLessThan(5);
    await expect(page.getByRole('option', { name: /PLN/i }).first()).toBeVisible();
  });
});
