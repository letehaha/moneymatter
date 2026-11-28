import { test, expect } from '@playwright/test';

import { completeOnboarding, createAccount } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'ic' });

let dataSeeded = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

test.describe('Investment Calculator', () => {
  test.use({
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 900 },
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });

    if (!dataSeeded) {
      await completeOnboarding({ request: page.request, currencyCode: CURRENCY });
      await createAccount({
        request: page.request,
        name: 'Test Savings',
        currencyCode: CURRENCY,
        initialBalance: 10000,
      });
      dataSeeded = true;
    }

    await page.goto('/analytics/investment-calculator');
    // Wait for chart to render (always visible in both compact and non-compact layouts)
    await expect(page.getByTestId('projection-chart')).toBeVisible({ timeout: 15_000 });

    // In compact mode, inputs are hidden behind a "Configure" toggle — expand them
    const configureBtn = page.locator('button').filter({ hasText: /configure/i });
    if (await configureBtn.isVisible()) {
      await configureBtn.click();
      await expect(page.locator('button[role="combobox"]')).toBeVisible({ timeout: 5_000 });
    }
  });

  // Scoped locator for the summary cards grid (inside the results panel)
  const summaryCards = (page: import('@playwright/test').Page) => page.getByTestId('summary-cards');

  test('renders all calculator sections', async ({ page }) => {
    // Input labels should be visible
    const inputLabels = page.locator('label.text-sm');
    await expect(inputLabels.first()).toBeVisible({ timeout: 10_000 });
    const labelCount = await inputLabels.count();
    expect(labelCount).toBeGreaterThanOrEqual(4);

    // Initial balance input should be present
    await expect(page.locator('input[inputmode="decimal"]').first()).toBeVisible();

    // Indicator selector (combobox)
    const combobox = page.locator('button[role="combobox"]');
    await expect(combobox).toBeVisible();
    await expect(combobox).toContainText(/S&P 500/);

    // Summary cards should display monetary values
    const summary = summaryCards(page);
    await expect(summary).toBeVisible();
    await expect(summary.locator('text=/\\$[\\d,.]+/').first()).toBeVisible();

    // Multiplier card shows Nx format
    await expect(summary.getByText(/\d+\.\d+x/)).toBeVisible();

    // "Use current balance" button
    await expect(page.locator('button').filter({ hasText: /current balance/i })).toBeVisible();

    // Chart SVG rendered
    await expect(page.getByTestId('projection-chart')).toBeVisible();
  });

  test('chart renders with lines and legend', async ({ page }) => {
    const svg = page.getByTestId('projection-chart');
    await expect(svg).toBeVisible({ timeout: 10_000 });

    // Chart should have rendered line paths (nominal, real, totalInvested)
    const paths = svg.locator('path[d]');
    await expect(paths.first()).toBeVisible();
    const pathCount = await paths.count();
    expect(pathCount).toBeGreaterThanOrEqual(3);

    // X-axis should show year labels (e.g., "2yr", "4yr")
    await expect(svg.getByText(/\d+yr/).first()).toBeVisible();

    // Legend should be visible below the chart
    const legend = page.getByTestId('chart-legend');
    await expect(legend).toBeVisible();
    await expect(legend.getByText(/invested/i)).toBeVisible();
  });

  test('changing initial balance updates summary', async ({ page }) => {
    const balanceInput = page.locator('input[inputmode="decimal"]').first();
    await expect(balanceInput).toBeVisible({ timeout: 10_000 });

    // Set a specific large balance and blur to trigger native @change
    await balanceInput.fill('100000');
    await balanceInput.blur();

    // $100,000 should appear in the summary breakdown (auto-retries until visible)
    const summary = summaryCards(page);
    await expect(summary.getByText(/100,000/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('indicator selector changes return rate and updates results', async ({ page }) => {
    const combobox = page.locator('button[role="combobox"]');
    await expect(combobox).toBeVisible({ timeout: 10_000 });
    await expect(combobox).toContainText(/S&P 500/);

    // Record summary before change
    const summary = summaryCards(page);
    await expect(summary).toBeVisible();
    const beforeText = await summary.textContent();

    // Open selector and pick a different indicator
    await combobox.click();
    const treasuryOption = page.getByRole('option').filter({ hasText: /Treasury/i });
    await expect(treasuryOption).toBeVisible();
    await treasuryOption.click();

    // Selector should now show the new indicator
    await expect(combobox).toContainText(/Treasury/i);

    // Wait for recalculation
    await page.waitForTimeout(300);

    // Summary should have changed (lower return = lower values)
    const afterText = await summary.textContent();
    expect(afterText).not.toEqual(beforeText);
  });

  test('slider range popover opens with min/max inputs', async ({ page }) => {
    // Find the settings button next to the balance input
    const balanceInput = page.locator('input[inputmode="decimal"]').first();
    await expect(balanceInput).toBeVisible({ timeout: 10_000 });
    const settingsBtn = balanceInput.locator('xpath=..').locator('button').first();
    await settingsBtn.click();

    // Popover should show Min/Max labels and inputs
    await expect(page.getByText('Min', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Max', { exact: true })).toBeVisible({ timeout: 5_000 });

    // Close popover by pressing Escape
    await page.keyboard.press('Escape');
    await expect(page.getByText('Min', { exact: true })).not.toBeVisible({ timeout: 5_000 });
  });

  test('time horizon slider changes update display and summary', async ({ page }) => {
    // Target the horizon value display
    const horizonValue = page.getByTestId('horizon-value');
    await expect(horizonValue).toHaveText('10yr', { timeout: 10_000 });

    // Record summary before change
    const summary = summaryCards(page);
    const beforeText = await summary.textContent();

    // Focus the time horizon slider thumb (3rd slider) and use keyboard
    // The [role="slider"] element is CSS-hidden by reka-ui but can receive focus
    const horizonSlider = page.locator('[role="slider"]').nth(2);
    await horizonSlider.focus({ timeout: 5_000 });

    // Press ArrowRight multiple times to increase horizon
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
    }

    // Wait for recalculation
    await page.waitForTimeout(500);

    // The horizon value display should have increased (no longer "10yr")
    await expect(horizonValue).not.toHaveText('10yr');

    // Summary should have changed (longer horizon = higher values)
    const afterText = await summary.textContent();
    expect(afterText).not.toEqual(beforeText);
  });

  test('custom indicator shows return rate input', async ({ page }) => {
    const combobox = page.locator('button[role="combobox"]');
    await expect(combobox).toBeVisible({ timeout: 10_000 });

    // Select "Custom" indicator
    await combobox.click();
    const customOption = page.getByRole('option').filter({ hasText: /custom/i });
    await expect(customOption).toBeVisible();
    await customOption.click();

    // A custom return rate input field should appear
    const customInput = page.locator('input[type="number"]').last();
    await expect(customInput).toBeVisible();

    // Enter a custom rate
    await customInput.fill('15');
    await customInput.dispatchEvent('change');

    await page.waitForTimeout(300);

    // Summary should reflect the return rate change
    const summary = summaryCards(page);
    await expect(summary.locator('text=/\\$[\\d,.]+/').first()).toBeVisible();
  });
});
