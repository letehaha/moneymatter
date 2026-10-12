import { type Locator, type Page, expect, test } from '@playwright/test';

import { completeOnboarding, createAccount } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';
import { pickDialogSelect } from '../../helpers/ui';

const CURRENCY = 'USD';
const EVERY_PLACEHOLDER = 'e.g. 10';
const CUSTOM_MONTHS = 3;
const MAX_DAYS = 366;
const MAX_MONTHS = 12;

const creds = buildTestCredentials({ prefix: 'bcc' });

let dataSeeded = false;

const openCustomCadence = async ({ page }: { page: Page }): Promise<Locator> => {
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Start budgeting' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Custom', exact: true }).click();
  // With pre-fill on the submit button reads "Next" and opens the setup questions.
  await dialog.getByRole('switch', { name: 'Smart pre-fill' }).setChecked(false);
  return dialog;
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

test.describe('Budget custom cadence', () => {
  test.use({
    ignoreHTTPSErrors: true,
    // Above the `uiMobile` breakpoint so ResponsiveDialog renders a real `dialog` role.
    viewport: { width: 1280, height: 900 },
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });

    if (!dataSeeded) {
      await completeOnboarding({ request: page.request, currencyCode: CURRENCY });
      await createAccount({
        request: page.request,
        name: 'E2E Budget Account',
        currencyCode: CURRENCY,
        initialBalance: 1000,
      });
      dataSeeded = true;
    }
  });

  test('rejects intervals outside the limit of the picked unit', async ({ page }) => {
    const dialog = await openCustomCadence({ page });
    const every = dialog.getByPlaceholder(EVERY_PLACEHOLDER);
    const submit = dialog.getByRole('button', { name: 'Create budget' });

    await expect(submit).toBeDisabled();

    await every.fill(String(MAX_DAYS + 1));
    await expect(dialog.getByText(`Enter a whole number from 1 to ${MAX_DAYS}.`)).toBeVisible();
    await expect(submit).toBeDisabled();

    await every.fill(String(MAX_DAYS));
    await expect(submit).toBeEnabled();

    await pickDialogSelect({ page, nth: 0, optionName: 'Months' });
    await expect(dialog.getByText(`Enter a whole number from 1 to ${MAX_MONTHS}.`)).toBeVisible();
    await expect(submit).toBeDisabled();

    await every.fill(String(MAX_MONTHS));
    await expect(submit).toBeEnabled();

    await every.fill(String(MAX_MONTHS + 1));
    await dialog.getByRole('button', { name: 'Monthly', exact: true }).click();
    await expect(submit).toBeEnabled();
  });

  test('creates a budget that resets every N months', async ({ page }) => {
    const dialog = await openCustomCadence({ page });

    await dialog.getByPlaceholder(EVERY_PLACEHOLDER).fill(String(CUSTOM_MONTHS));
    await pickDialogSelect({ page, nth: 0, optionName: 'Months' });

    const createRequest = page.waitForRequest(
      (request) => request.method() === 'POST' && /\/budget-plans$/.test(new URL(request.url()).pathname),
    );
    await dialog.getByRole('button', { name: 'Create budget' }).click();

    expect((await createRequest).postDataJSON()).toMatchObject({ cadence: 'months', intervalN: CUSTOM_MONTHS });

    await page.waitForURL(/\/budget\/[^/]+$/);
    await page.getByRole('button', { name: 'Budget settings' }).first().click();
    await expect(page.getByText(`Every ${CUSTOM_MONTHS} months`)).toBeVisible();
  });
});
