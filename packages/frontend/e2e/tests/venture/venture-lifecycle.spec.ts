import { expect, test } from '@playwright/test';

import {
  createAccount,
  createTransaction,
  createVentureDeal,
  createVentureEvent,
  createVenturePlatform,
  extractId,
  getVentureDeal,
  completeOnboarding,
  signInViaApi,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

/**
 * Full venture investment lifecycle. Drives the event chain via the API,
 * then verifies the deal status transitions surface in the UI as the
 * events fire — initial deposit, NAV update, partial distribution →
 * `partial_exit`, final exit → `fully_exited`.
 */

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'vl' });

test.describe.configure({ mode: 'serial' });

let request: Awaited<ReturnType<typeof signInViaApi>>;
let dealId: string;
let accountId: string;

test.beforeAll(async ({ playwright }) => {
  // Sign up + verify via raw fetch, then sign in via API to get a session
  await signUpAndVerify({ creds });
  request = await signInViaApi({ playwright, email: creds.email, password: creds.password });
  await completeOnboarding({ request, currencyCode: CURRENCY });

  const accountResponse = await createAccount({
    request,
    name: 'USD Bank',
    currencyCode: CURRENCY,
    initialBalance: 50000,
  });
  accountId = extractId(accountResponse);

  const platformResponse = await createVenturePlatform({
    request,
    payload: {
      name: 'Acme Ventures',
      defaultEntryFeePct: '0.085',
      defaultCarryPct: '0.2',
      defaultHurdlePct: '0',
    },
  });
  const platformId = extractId(platformResponse);

  const dealResponse = await createVentureDeal({
    request,
    payload: {
      name: 'SK 116',
      currencyCode: CURRENCY,
      principal: '16000',
      investmentDate: '2026-03-24',
      platformId,
    },
  });
  dealId = extractId(dealResponse);
});

test.describe('Venture Investment Lifecycle', () => {
  test.use({
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  });

  test('initial investment → deal appears in /venture, status=outstanding', async ({ page }) => {
    // Backend-side: create the initial_investment event linking a $17,360 expense tx.
    const initialTx = await createTransaction({
      request,
      accountId,
      amount: 17360,
      transactionType: 'expense',
    });
    await createVentureEvent({
      request,
      dealId,
      payload: {
        type: 'initial_investment',
        eventDate: '2026-03-24',
        cashFlowMode: 'linked',
        transactionIds: [extractId(initialTx)],
      },
    });

    // Verify backend status
    const deal = await getVentureDeal({ request, dealId });
    expect(deal.response.status).toBe('outstanding');

    // UI verification — deal card surfaces on /venture
    await loginViaUI({ page, email: creds.email, password: creds.password });
    await page.goto('/venture');
    await page.waitForURL(/\/venture$/, { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'SK 116' }).first()).toBeVisible({ timeout: 10_000 });
    // Status pill on the card
    await expect(page.locator('text=/outstanding/i').first()).toBeVisible();
  });

  test('NAV update → deal detail still shows outstanding (NAV alone does not flip status)', async ({ page }) => {
    await createVentureEvent({
      request,
      dealId,
      payload: {
        type: 'nav_update',
        eventDate: '2026-06-24',
        cashFlowMode: 'none',
        navAfter: '18500',
      },
    });

    const deal = await getVentureDeal({ request, dealId });
    expect(deal.response.status).toBe('outstanding');

    // UI: deal detail page renders
    await loginViaUI({ page, email: creds.email, password: creds.password });
    await page.goto(`/venture/deals/${dealId}`);
    await page.waitForURL(/\/venture\/deals\//, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'SK 116', level: 1 })).toBeVisible();
  });

  test('distribution event $5,000 (all principal return, no carry) → status=partial_exit', async ({ page }) => {
    const distTx = await createTransaction({
      request,
      accountId,
      amount: 5000,
      transactionType: 'income',
    });

    await createVentureEvent({
      request,
      dealId,
      payload: {
        type: 'distribution',
        eventDate: '2027-03-24',
        cashFlowMode: 'linked',
        grossAmount: '5000',
        transactionIds: [extractId(distTx)],
      },
    });

    const deal = await getVentureDeal({ request, dealId });
    expect(deal.response.status).toBe('partial_exit');

    // UI: re-fetch deal detail, verify partial_exit label is rendered
    await loginViaUI({ page, email: creds.email, password: creds.password });
    await page.goto(`/venture/deals/${dealId}`);
    await expect(page.locator('text=/partial.exit/i').first()).toBeVisible({ timeout: 10_000 });
  });

  test('final exit ($25k, navAfter=0) → carry=$2,528, status=fully_exited', async ({ page }) => {
    const exitTx = await createTransaction({
      request,
      accountId,
      amount: 22472,
      transactionType: 'income',
    });

    const exitResponse = await createVentureEvent({
      request,
      dealId,
      payload: {
        type: 'exit',
        eventDate: '2029-03-24',
        cashFlowMode: 'linked',
        grossAmount: '25000',
        navAfter: '0',
        transactionIds: [extractId(exitTx)],
      },
    });

    // costBasis=17360, cumulativeReturned=5000, principalRemaining=12360
    // principalReturnedThisEvent=12360, profit=12640, carry=0.2*12640=2528
    // lpNet=22472
    expect(Number(exitResponse.response.gpCarryAmount)).toBeCloseTo(2528, 2);
    expect(Number(exitResponse.response.lpNetAmount)).toBeCloseTo(22472, 2);

    const deal = await getVentureDeal({ request, dealId });
    expect(deal.response.status).toBe('fully_exited');

    // UI: verify status label updates
    await loginViaUI({ page, email: creds.email, password: creds.password });
    await page.goto(`/venture/deals/${dealId}`);
    await expect(page.locator('text=/fully.exited/i').first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Venture Investment Failure Flows', () => {
  test("linking a tx that's already linked to a venture event is rejected", async ({ playwright }) => {
    const failCreds = buildTestCredentials({ prefix: 'vlf' });
    await signUpAndVerify({ creds: failCreds });
    const failRequest = await signInViaApi({
      playwright,
      email: failCreds.email,
      password: failCreds.password,
    });
    await completeOnboarding({ request: failRequest, currencyCode: CURRENCY });

    const account = await createAccount({
      request: failRequest,
      name: 'USD Bank',
      currencyCode: CURRENCY,
      initialBalance: 100000,
    });
    const acctId = extractId(account);

    const dealA = await createVentureDeal({
      request: failRequest,
      payload: {
        name: 'Deal A',
        currencyCode: CURRENCY,
        principal: '5000',
        investmentDate: '2026-03-24',
        entryFeePct: '0',
      },
    });
    const dealB = await createVentureDeal({
      request: failRequest,
      payload: {
        name: 'Deal B',
        currencyCode: CURRENCY,
        principal: '5000',
        investmentDate: '2026-03-24',
        entryFeePct: '0',
      },
    });

    const tx = await createTransaction({
      request: failRequest,
      accountId: acctId,
      amount: 5000,
      transactionType: 'expense',
    });

    // First link succeeds
    await createVentureEvent({
      request: failRequest,
      dealId: extractId(dealA),
      payload: {
        type: 'initial_investment',
        eventDate: '2026-03-24',
        cashFlowMode: 'linked',
        transactionIds: [extractId(tx)],
      },
    });

    // Second link to Deal B with same tx should fail at the API level (422 ValidationError)
    const conflictResponse = await failRequest.post(
      `${process.env.PLAYWRIGHT_API_BASE_URL || 'https://localhost:8081'}/api/v1/venture/deals/${extractId(dealB)}/events`,
      {
        data: {
          type: 'initial_investment',
          eventDate: '2026-03-24',
          cashFlowMode: 'linked',
          transactionIds: [extractId(tx)],
        },
      },
    );
    expect(conflictResponse.status()).toBe(422);
  });
});
