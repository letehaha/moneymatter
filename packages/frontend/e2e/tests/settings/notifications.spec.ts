import { type APIRequestContext, expect, test } from '@playwright/test';

import { completeOnboarding, signInViaApi } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { type TestCredentials, buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL || 'https://localhost:8081';

let user: TestCredentials;
let userApi: APIRequestContext;
let isPushConfigured = false;

// Chromium shows no permission prompt when the permission is already granted, so the toggle's
// click goes straight to `pushManager.subscribe()`. That call reaches Google's push service,
// so this flow needs a backend with VAPID keys and a network.
test.use({ permissions: ['notifications'] });
test.describe.configure({ mode: 'serial' });

test.describe('Settings → Notifications', () => {
  test.beforeAll(async ({ playwright }) => {
    user = buildTestCredentials({ prefix: 'push' });
    await signUpAndVerify({ creds: user });

    userApi = await signInViaApi({ playwright, email: user.email, password: user.password });
    await completeOnboarding({ request: userApi, currencyCode: CURRENCY });

    const response = await userApi.get(`${API_BASE_URL}/api/v1/push/config`);
    const body = (await response.json()) as { response?: { enabled?: boolean } };
    isPushConfigured = body.response?.enabled === true;
  });

  test.afterAll(async () => {
    await userApi?.dispose();
  });

  test('enables this device, sends a test notification and removes the device', async ({ page }) => {
    test.skip(!isPushConfigured, 'The backend has no VAPID keys, so the Notifications tab is hidden');

    await loginViaUI({ page, email: user.email, password: user.password });
    await page.goto('/settings/notifications');

    const toggle = page.getByRole('switch', { name: 'Browser notifications on this device' });
    await expect(toggle).toBeEnabled({ timeout: 30_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });

    const devices = page.getByRole('list').filter({ hasText: 'This device' });
    await expect(devices.getByText('This device')).toBeVisible();

    await page.getByRole('button', { name: 'Send test notification' }).click();
    await expect(page.getByText(/Test notification: \d+ sent/)).toBeVisible();

    await page.getByRole('button', { name: 'Remove device' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByText('No devices yet')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('keeps the group switches after a reload', async ({ page }) => {
    test.skip(!isPushConfigured, 'The backend has no VAPID keys, so the Notifications tab is hidden');

    await loginViaUI({ page, email: user.email, password: user.password });
    await page.goto('/settings/notifications');

    const releases = page.getByRole('switch', { name: 'New releases' });
    await expect(releases).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });

    const saved = page.waitForResponse(
      (response) => response.url().includes('/api/v1/user/settings') && response.request().method() === 'PATCH',
    );
    await releases.click();
    expect((await saved).ok()).toBe(true);

    await page.reload();
    await expect(page.getByRole('switch', { name: 'New releases' })).toHaveAttribute('aria-checked', 'true', {
      timeout: 30_000,
    });
  });
});
