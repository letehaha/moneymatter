import { expect, test } from '@playwright/test';

import { completeOnboarding } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'syncstuck' });

const STUCK_THRESHOLD_MS = 1500;

// Backend response that stays "syncing" forever — used to drive the watchdog test.
const stuckStatusPayload = () => ({
  lastSyncAt: null,
  summary: { total: 2, syncing: 2, queued: 0, completed: 0, failed: 0, idle: 0 },
  accounts: [
    {
      accountId: 9001,
      accountName: 'Mock EUR Wallet',
      providerType: 'walutomat',
      status: 'syncing',
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    },
    {
      accountId: 9002,
      accountName: 'Mock PLN Wallet',
      providerType: 'walutomat',
      status: 'syncing',
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    },
  ],
});

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

test.describe('Sync popover — stuck-state watchdog', () => {
  test.use({
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  });

  test('exits infinite spinner and surfaces recovery actions when sync stalls', async ({ page }) => {
    // Override the watchdog threshold to ~1.5s so the test runs fast.
    // The composable reads this from window before scheduling its setTimeout.
    await page.addInitScript((thresholdMs) => {
      (window as unknown as { testSyncStuckMs: number }).testSyncStuckMs = thresholdMs;
    }, STUCK_THRESHOLD_MS);

    // Mock the sync endpoints to return a perpetually-syncing state.
    // The frontend hits these as soon as the header mounts.
    await page.route('**/api/v1/bank-data-providers/sync/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', response: stuckStatusPayload() }),
      });
    });
    await page.route('**/api/v1/bank-data-providers/sync/check', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', response: { syncTriggered: false } }),
      });
    });
    // Stub SSE so the EventSource connection doesn't push real updates that
    // would override our mocked status.
    await page.route('**/api/v1/sse/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: '',
      });
    });

    await loginViaUI({ page, email: creds.email, password: creds.password });
    await completeOnboarding({ request: page.request, currencyCode: CURRENCY });

    await page.goto('/dashboard');
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    // While syncing, the header button shows "Syncing X accounts" / spinner.
    const syncingButton = page.getByRole('button', { name: /syncing/i });
    await expect(syncingButton).toBeVisible({ timeout: 15_000 });

    // Wait past the watchdog threshold; the spinner should give way to a
    // "Sync stuck" indicator instead of running forever.
    const stuckButton = page.getByRole('button', { name: /sync stuck/i });
    await expect(stuckButton).toBeVisible({ timeout: STUCK_THRESHOLD_MS + 5_000 });
    await expect(syncingButton).toHaveCount(0);

    // Open the popover and verify the stuck banner + recovery actions.
    await stuckButton.click();

    await expect(page.getByText(/sync seems stuck/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /retry sync/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /manage connections/i })).toBeVisible();
  });
});
