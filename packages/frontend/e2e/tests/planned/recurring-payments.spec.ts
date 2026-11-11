import { type Locator, type Page, expect, test } from '@playwright/test';

import { completeOnboarding, createAccount, createSubscription, extractId } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';
import { pickDialogSelect, waitForSuccessToast } from '../../helpers/ui';

const CURRENCY = 'USD';
const LIST_URL = '/planned/recurring-payments';

const NAME_PLACEHOLDER = 'e.g. Netflix, Electricity bill';
const AMOUNT_PLACEHOLDER = '0.00';
const NOTES_PLACEHOLDER = 'Optional notes about this subscription';
const KEYWORD_PLACEHOLDER = 'Enter keyword';
const INTERVAL_COUNT_PLACEHOLDER = 'e.g. 30';

const QUICK_ADD_NAME = 'E2E Quick Netflix';
const SEEDED_NAME = 'E2E Seeded Gym';
const RENAMED_NAME = 'E2E Renamed Gym';
const ORGANIZE_NOTES = 'E2E organize notes';
const DUE_DATE_INPUT = '2030-06-15T12:00';
const DUE_DATE_LABEL = 'Jun 15, 2030';

const creds = buildTestCredentials({ prefix: 'rp' });

let seededSubscriptionId: string;
let dataSeeded = false;

/** The four detail-page summary cards; their edit buttons are icon-only, so they are reached through the card. */
const summaryCard = ({ page, title }: { page: Page; title: string }): Locator =>
  page
    .locator('div.bg-card')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();

const openCardEditor = async ({ page, title }: { page: Page; title: string }): Promise<Locator> => {
  const card = summaryCard({ page, title });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button').first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
};

const gotoDetails = async ({ page }: { page: Page }): Promise<void> => {
  await page.goto(`${LIST_URL}/${seededSubscriptionId}`);
  await page.waitForURL(new RegExp(`${LIST_URL}/${seededSubscriptionId}`), { timeout: 15_000 });
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

test.describe('Recurring Payments', () => {
  test.use({
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Two constraints on the width:
    // 1. Above the `uiMobile` breakpoint (767px) so ResponsiveDialog/ResponsiveAlertDialog
    //    stay real `dialog`/`alertdialog` roles instead of mobile Drawers.
    // 2. At or above Tailwind's `lg` (1024px) so the detail page's desktop action row
    //    (`hidden lg:flex`) renders its Delete button instead of the ellipsis popover.
    viewport: { width: 1280, height: 900 },
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });

    if (!dataSeeded) {
      await completeOnboarding({ request: page.request, currencyCode: CURRENCY });

      await createAccount({
        request: page.request,
        name: 'E2E Recurring Account',
        currencyCode: CURRENCY,
        initialBalance: 10000,
      });

      const subscription = await createSubscription({
        request: page.request,
        payload: {
          name: SEEDED_NAME,
          type: 'subscription',
          transactionType: 'expense',
          frequency: 'monthly',
          expectedAmount: 42.5,
          expectedCurrencyCode: CURRENCY,
          startDate: new Date().toISOString().slice(0, 10),
        },
      });
      seededSubscriptionId = extractId(subscription);

      dataSeeded = true;
    }
  });

  // ─── 1. Quick-add happy path ────────────────────────────────────────

  test('quick-add creates a recurring payment and opens its detail page', async ({ page }) => {
    await page.goto(LIST_URL);
    await page.waitForURL(/\/planned\/recurring-payments/, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Add Recurring Payment' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.getByPlaceholder(NAME_PLACEHOLDER).fill(QUICK_ADD_NAME);
    await dialog.getByPlaceholder(AMOUNT_PLACEHOLDER).fill('12.34');

    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await page.waitForURL(/\/planned\/recurring-payments\/[^/]+$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: QUICK_ADD_NAME })).toBeVisible({ timeout: 15_000 });

    const basicsCard = summaryCard({ page, title: 'Basics' });
    await expect(basicsCard).toContainText(/12[.,]34/);
    await expect(basicsCard).toContainText(CURRENCY);
  });

  // ─── 2. Quick-add validation ────────────────────────────────────────

  test('quick-add blocks submission when the name is empty', async ({ page }) => {
    await page.goto(LIST_URL);
    await page.waitForURL(/\/planned\/recurring-payments/, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Add Recurring Payment' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.getByPlaceholder(AMOUNT_PLACEHOLDER).fill('5');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(dialog.getByText('Field is required')).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/planned\/recurring-payments$/);
  });

  // ─── 3. Edit Basics ─────────────────────────────────────────────────

  test('basics editor renames the recurring payment', async ({ page }) => {
    await gotoDetails({ page });
    await expect(page.getByRole('heading', { name: SEEDED_NAME })).toBeVisible({ timeout: 15_000 });

    const dialog = await openCardEditor({ page, title: 'Basics' });
    await dialog.getByPlaceholder(NAME_PLACEHOLDER).fill(RENAMED_NAME);
    await dialog.getByRole('button', { name: 'Update', exact: true }).click();

    await waitForSuccessToast({ page });
    await expect(page.getByRole('heading', { name: RENAMED_NAME })).toBeVisible({ timeout: 15_000 });
  });

  // ─── 4. Edit Schedule ───────────────────────────────────────────────

  test('schedule editor sets a due date and frequency', async ({ page }) => {
    await gotoDetails({ page });

    const dialog = await openCardEditor({ page, title: 'Schedule' });

    await pickDialogSelect({ page, nth: 0, optionName: /^Annual$/ });
    await dialog.locator('input[type="datetime-local"]').first().fill(DUE_DATE_INPUT);

    await dialog.getByRole('button', { name: 'Update', exact: true }).click();

    await waitForSuccessToast({ page });
    await expect(summaryCard({ page, title: 'Schedule' })).toContainText('Annual', { timeout: 15_000 });
    await expect(page.getByText(DUE_DATE_LABEL).first()).toBeVisible({ timeout: 15_000 });
  });

  test('schedule editor sets a custom 30-day interval', async ({ page }) => {
    await gotoDetails({ page });

    const dialog = await openCardEditor({ page, title: 'Schedule' });

    await pickDialogSelect({ page, nth: 0, optionName: /^Custom$/ });
    await dialog.getByPlaceholder(INTERVAL_COUNT_PLACEHOLDER).fill('30');
    await pickDialogSelect({ page, nth: 1, optionName: /^days$/ });

    await dialog.getByRole('button', { name: 'Update', exact: true }).click();

    await waitForSuccessToast({ page });
    await expect(summaryCard({ page, title: 'Schedule' })).toContainText('Every 30 days', { timeout: 15_000 });
  });

  // ─── 5. Automation guard + matching rules ───────────────────────────

  test('automation editor requires a complete rule before saving match mode', async ({ page }) => {
    await gotoDetails({ page });

    const dialog = await openCardEditor({ page, title: 'Automation' });

    await dialog.locator('label').filter({ hasText: 'Match bank transactions' }).click();

    const saveButton = dialog.getByRole('button', { name: 'Update', exact: true });
    await expect(saveButton).toBeDisabled();
    await expect(dialog.getByText(/Add at least one complete rule/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Add Rule' }).click();
    await dialog.getByPlaceholder(KEYWORD_PLACEHOLDER).fill('e2e-gym-keyword');

    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await waitForSuccessToast({ page });

    const automationCard = summaryCard({ page, title: 'Automation' });
    await expect(automationCard).toContainText('Match bank transactions', { timeout: 15_000 });
    await expect(automationCard).toContainText(/1 matching rules? configured/);
  });

  // ─── 6. Organize ────────────────────────────────────────────────────

  test('organize editor saves notes', async ({ page }) => {
    await gotoDetails({ page });

    const dialog = await openCardEditor({ page, title: 'Organize' });
    await dialog.getByPlaceholder(NOTES_PLACEHOLDER).fill(ORGANIZE_NOTES);
    await dialog.getByRole('button', { name: 'Update', exact: true }).click();

    await waitForSuccessToast({ page });
    await expect(summaryCard({ page, title: 'Organize' })).toContainText('Added', { timeout: 15_000 });
    await expect(page.getByText(ORGANIZE_NOTES)).toBeVisible({ timeout: 15_000 });
  });

  // ─── 7. Delete from the detail page ─────────────────────────────────

  test('deleting from the detail page returns to the list without the item', async ({ page }) => {
    await gotoDetails({ page });
    await expect(page.getByRole('heading', { name: RENAMED_NAME })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();

    const alertDialog = page.getByRole('alertdialog');
    await expect(alertDialog).toBeVisible({ timeout: 10_000 });
    await alertDialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await page.waitForURL(/\/planned\/recurring-payments$/, { timeout: 20_000 });
    // The quick-add item survives the delete, so its row proves the list finished loading
    // before the absence assertion runs.
    await expect(page.getByText(QUICK_ADD_NAME).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(RENAMED_NAME)).toHaveCount(0);
  });
});
