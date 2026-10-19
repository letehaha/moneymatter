import { expect, test } from '@playwright/test';

import {
  completeOnboarding,
  createHolding,
  createInvestmentTransaction,
  createPortfolio,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
// Holding transactions are fetched in pages of 30 (useGetHoldingTransactionsInfinite),
// so 45 transactions guarantees a second page exists.
const TX_COUNT = 45;
const creds = buildTestCredentials({ prefix: 'hts' });

let portfolioId: string;
let dataSeeded = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

async function seedTestData({ request }: { request: import('@playwright/test').APIRequestContext }): Promise<void> {
  if (dataSeeded) return;

  await completeOnboarding({ request, currencyCode: CURRENCY });

  const pRes = await createPortfolio({ request, name: 'Infinite Scroll Portfolio' });
  portfolioId = pRes.response.id;

  const holdingRes = await createHolding({
    request,
    portfolioId,
    symbol: 'ISCRL',
  });
  const securityId = holdingRes.response.securityId;

  // Unique sequential dates so the list (sorted by date desc) has a known
  // oldest transaction that can only arrive with the second page.
  for (let i = 0; i < TX_COUNT; i++) {
    const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    await createInvestmentTransaction({
      request,
      portfolioId,
      securityId,
      category: 'buy',
      date,
      quantity: '1',
      price: '100',
    });
  }

  dataSeeded = true;
}

test.describe('Holding transactions infinite scroll', () => {
  test.use({
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    await seedTestData({ request: page.request });
  });

  test('scrolling the transactions list loads the next page', async ({ page }) => {
    await page.goto(`/portfolios/${portfolioId}`);

    const holdingRow = page.locator('table tbody tr').filter({ hasText: 'ISCRL' }).first();
    await expect(holdingRow).toBeVisible({ timeout: 10_000 });
    // First button in the row is the expand chevron
    await holdingRow.locator('button').first().click();

    // The ScrollArea viewport is both the scrollable element and the
    // virtualizer's scroll element.
    const scrollContainer = page
      .getByTestId('investment-transactions-scroll-area')
      .locator('[data-reka-scroll-area-viewport]');
    await expect(scrollContainer).toBeVisible({ timeout: 10_000 });

    // First page only: newest 30 of 45 transactions (14/02/2025 .. 16/01/2025,
    // date DESC). The oldest tx (01/01/2025) belongs to the second page and
    // must not be loaded yet.
    await expect(scrollContainer.getByText('14/02/2025')).toBeAttached();
    await expect(scrollContainer.getByText('01/01/2025')).not.toBeAttached();

    const nextPageRequest = page.waitForRequest(
      (req) => req.url().includes('/transactions') && req.url().includes('offset=30'),
      { timeout: 15_000 },
    );

    // The container is virtualized: rendered rows only advance when the
    // container itself scrolls. Keep pushing to the bottom until the
    // virtualizer reaches the loader row and triggers fetchNextPage.
    await expect(async () => {
      await scrollContainer.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const { scrollTop } = await scrollContainer.evaluate((el) => ({ scrollTop: el.scrollTop }));
      expect(scrollTop).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });

    await nextPageRequest;

    // Second page rendered: keep scrolling down until the oldest transaction
    // becomes part of the virtualized window.
    await expect(async () => {
      await scrollContainer.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(scrollContainer.getByText('01/01/2025')).toBeAttached({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
  });
});
