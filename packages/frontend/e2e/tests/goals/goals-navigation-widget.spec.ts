import { type Locator, type Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { completeOnboarding } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import {
  ACCOUNT_CATEGORY,
  createAccountOfCategory,
  createGoal,
  deleteGoal,
  listGoals,
  updateGoal,
} from '../../helpers/goals';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const DAY_MS = 86_400_000;
const AVG_DAYS_PER_MONTH = 30.44;
const MOBILE_VIEWPORT = { width: 400, height: 860 };

const creds = buildTestCredentials({ prefix: 'gnw' });

let onboarded = false;

const monthYear = ({ monthsAhead }: { monthsAhead: number }) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + monthsAhead, 1)).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const targetDateAhead = ({ monthsAhead }: { monthsAhead: number }) => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() + monthsAhead, 15));
  const now0 = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return { iso: date.toISOString().slice(0, 10), daysLeft: (date.getTime() - now0) / DAY_MS };
};

// D13: below 10 000 whole amounts, 10k–100k compact with up to 2 decimals and trailing zeros dropped.
const formatGoalAmountUnder100k = ({ amount }: { amount: number }) =>
  amount >= 10_000 ? `$${Number((amount / 1_000).toFixed(2))}k` : `$${amount.toLocaleString('en-US')}`;

const parseFirstAmount = ({ text }: { text: string }) => {
  const match = text.match(/\$([\d,]+(?:\.\d+)?)/);
  if (!match) throw new Error(`No amount in "${text}"`);
  return Number(match[1]!.replace(/,/g, ''));
};

const goalsWidget = ({ page }: { page: Page }) => page.locator('[data-widget-id="goals"]');

const widgetRow = ({ page, name }: { page: Page; name: string }) =>
  goalsWidget({ page }).getByRole('link').filter({ hasText: name });

const stripCell = ({ page, label }: { page: Page; label: string }) =>
  page.getByText(label, { exact: true }).first().locator('..');

const STRIP_LABELS = ['Target', 'Saved', 'Left', 'Needs', 'Pace'] as const;

async function openDashboard({ page }: { page: Page }) {
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible({ timeout: 15_000 });
}

async function saveLayout({ page }: { page: Page }) {
  const saved = page.waitForResponse(
    (response) => response.url().includes('/api/v1/user/settings') && response.request().method() !== 'GET',
  );
  await page.getByRole('button', { name: 'Done' }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible({ timeout: 30_000 });
}

async function boxOf({ locator }: { locator: Locator }) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element not measurable');
  return box;
}

async function expectWidgetRow({
  page,
  name,
  saved,
  target,
  status,
  timing,
}: {
  page: Page;
  name: string;
  saved: number;
  target: number;
  status: string;
  timing: string | RegExp;
}) {
  const row = widgetRow({ page, name });
  const percent = Math.round((saved / target) * 100);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(`${percent}%`);
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(percent));
  await expect(row).toContainText(
    `${formatGoalAmountUnder100k({ amount: saved })} of ${formatGoalAmountUnder100k({ amount: target })}`,
  );
  await expect(row).toContainText(status);
  await expect(row).toContainText(timing);
}

test.describe('Goals navigation, dashboard widget, deep links and mobile', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });

  test.beforeAll(async () => {
    await signUpAndVerify({ creds });
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    if (!onboarded) {
      await completeOnboarding({ request: page.request, currencyCode: CURRENCY });
      onboarded = true;
    }
  });

  test('nav entry, dashboard widget states and goal deep links', async ({ page }) => {
    test.setTimeout(240_000);
    const request = page.request;

    await test.step('Goals sits under Planning in the sidebar and opens /goals (docs overview)', async () => {
      await page.goto('/dashboard');
      const planned = page.getByRole('button', { name: 'Planning', exact: true });
      await expect(planned).toBeVisible({ timeout: 15_000 });
      if ((await planned.getAttribute('aria-expanded')) !== 'true') await planned.click();
      await expect(planned).toHaveAttribute('aria-expanded', 'true');
      const plannedGroup = page.locator(`#${await planned.getAttribute('aria-controls')}`);
      await expect(plannedGroup.getByRole('link')).toHaveText(['Budget', 'Goals', 'Trackers', 'Recurring payments']);

      await page.getByRole('link', { name: 'Goals', exact: true }).click();
      await expect(page).toHaveURL(/\/goals$/);
      await expect(page.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: 'How goals work' })).toHaveAttribute('href', /\/goals\/overview\//);
      await expect(page.getByRole('button', { name: 'New goal' }).first()).toBeVisible();
    });

    const savingsBalance = 10_000;
    const currentBalance = 6_200;
    const currentCreditLimit = 1_000;
    const cashBalance = 4_000;
    const giftBalance = 1_500;

    const savingsId = await createAccountOfCategory({
      request,
      name: 'Widget Savings',
      currencyCode: CURRENCY,
      initialBalance: savingsBalance,
      category: ACCOUNT_CATEGORY.saving,
    });
    const currentId = await createAccountOfCategory({
      request,
      name: 'Widget Current',
      currencyCode: CURRENCY,
      initialBalance: currentBalance,
      category: ACCOUNT_CATEGORY.currentAccount,
      creditLimit: currentCreditLimit,
    });
    const cashId = await createAccountOfCategory({
      request,
      name: 'Widget Cash',
      currencyCode: CURRENCY,
      initialBalance: cashBalance,
      category: ACCOUNT_CATEGORY.cash,
    });
    const giftId = await createAccountOfCategory({
      request,
      name: 'Widget Gift',
      currencyCode: CURRENCY,
      initialBalance: giftBalance,
      category: ACCOUNT_CATEGORY.general,
    });

    // A user without accounts sees dashboard onboarding instead of the widget grid.
    await test.step('Widget added from Customize shows "Create a goal" with no goals (docs dashboard#goals)', async () => {
      await openDashboard({ page });
      await expect(goalsWidget({ page })).toHaveCount(0);
      await page.getByRole('button', { name: 'Customize' }).click();
      await page.getByRole('button', { name: /^Goals/ }).click();
      await expect(goalsWidget({ page })).toBeVisible();
      await saveLayout({ page });

      await page.reload();
      const create = goalsWidget({ page }).getByRole('link', { name: 'Create a goal' });
      await expect(create).toBeVisible({ timeout: 15_000 });
      await create.click();
      await expect(page).toHaveURL(/\/goals$/);
    });

    const currentCounted = Math.max(0, currentBalance - currentCreditLimit);

    const carTarget = 21_000;
    const carMonthly = 700;
    const carDateMonthsAhead = 24;
    const carDate = targetDateAhead({ monthsAhead: carDateMonthsAhead });
    const carSaved = (100 / 100) * savingsBalance + (50 / 100) * currentCounted;
    const carLeft = carTarget - carSaved;
    const carEtaMonths = Math.ceil(carLeft / carMonthly);
    const carNeeds = carLeft / (carDate.daysLeft / AVG_DAYS_PER_MONTH);

    const holidayTarget = 8_000;
    const holidayMonthly = 500;
    const holidaySaved = (50 / 100) * cashBalance;
    const holidayEtaMonths = Math.ceil((holidayTarget - holidaySaved) / holidayMonthly);

    const rainyTarget = 5_200;
    const rainySaved = (50 / 100) * currentCounted;

    const car = await createGoal({
      request,
      name: 'Car fund',
      targetAmount: carTarget,
      currencyCode: CURRENCY,
      targetDate: carDate.iso,
      plannedMonthly: carMonthly,
      accounts: [
        { accountId: savingsId, sharePercent: 100 },
        { accountId: currentId, sharePercent: 50 },
      ],
    });
    const holiday = await createGoal({
      request,
      name: 'Holiday',
      targetAmount: holidayTarget,
      currencyCode: CURRENCY,
      plannedMonthly: holidayMonthly,
      accounts: [{ accountId: cashId, sharePercent: 50 }],
    });
    const rainy = await createGoal({
      request,
      name: 'Rainy day',
      targetAmount: rainyTarget,
      currencyCode: CURRENCY,
      accounts: [{ accountId: currentId, sharePercent: 50 }],
    });
    await updateGoal({ request, goalId: rainy.id, status: 'paused' });
    const oldTrip = await createGoal({
      request,
      name: 'Old trip',
      targetAmount: 3_000,
      currencyCode: CURRENCY,
      accounts: [{ accountId: cashId, sharePercent: 50 }],
    });
    await updateGoal({ request, goalId: oldTrip.id, status: 'archived' });
    const gift = await createGoal({
      request,
      name: 'Gift',
      targetAmount: giftBalance - 500,
      currencyCode: CURRENCY,
      accounts: [{ accountId: giftId, sharePercent: 100 }],
    });

    await test.step('Widget lists active and paused goals with hand-computed saved/target (docs dashboard#goals, plan D13)', async () => {
      await openDashboard({ page });
      await expectWidgetRow({
        page,
        name: 'Car fund',
        saved: carSaved,
        target: carTarget,
        status: 'Ahead',
        timing: `by ${monthYear({ monthsAhead: carDateMonthsAhead })}`,
      });
      expect(carEtaMonths).toBeLessThan(carDateMonthsAhead - 1);
      await expectWidgetRow({
        page,
        name: 'Holiday',
        saved: holidaySaved,
        target: holidayTarget,
        status: `around ${monthYear({ monthsAhead: holidayEtaMonths })}`,
        timing: /no date/i,
      });
      await expectWidgetRow({
        page,
        name: 'Rainy day',
        saved: rainySaved,
        target: rainyTarget,
        status: 'Paused',
        timing: /no date/i,
      });
    });

    await test.step('Widget leaves out archived and reached goals (docs dashboard#goals)', async () => {
      await expect(async () => {
        await page.reload();
        await expect(widgetRow({ page, name: 'Car fund' })).toBeVisible({ timeout: 10_000 });
        await expect(widgetRow({ page, name: 'Old trip' })).toHaveCount(0);
        await expect(widgetRow({ page, name: 'Gift' })).toHaveCount(0);
      }).toPass({ timeout: 30_000 });
    });

    await test.step('"View all" opens the Goals page (docs dashboard#goals)', async () => {
      await goalsWidget({ page }).getByRole('link', { name: 'View all' }).click();
      await expect(page).toHaveURL(/\/goals$/);
    });

    await test.step('Clicking a widget goal opens its detail with a 5-cell strip (docs dashboard#goals, plan D9)', async () => {
      await openDashboard({ page });
      await widgetRow({ page, name: 'Car fund' }).click();
      await expect(page).toHaveURL(new RegExp(`/goals/${car.id}$`));
      const heading = page.getByRole('heading', { name: 'Car fund', level: 1 });
      await expect(heading).toBeVisible({ timeout: 15_000 });
      const carDateLabel = `by ${monthYear({ monthsAhead: carDateMonthsAhead })}`;
      const caption = heading.locator('xpath=following-sibling::p');
      await expect(caption).toContainText(carDateLabel);
      await expect(caption).toContainText('2 accounts');
      await expect(heading.locator('xpath=ancestor::div[3]')).toContainText('Ahead');

      const tops = await Promise.all(
        STRIP_LABELS.map(async (label) => (await boxOf({ locator: stripCell({ page, label }) })).y),
      );
      for (const top of tops) expect(Math.abs(top - tops[0]!)).toBeLessThan(2);

      await expect(stripCell({ page, label: 'Target' })).toContainText(
        formatGoalAmountUnder100k({ amount: carTarget }),
      );
      await expect(stripCell({ page, label: 'Target' })).toContainText(carDateLabel);
      await expect(stripCell({ page, label: 'Saved' })).toContainText(formatGoalAmountUnder100k({ amount: carSaved }));
      await expect(stripCell({ page, label: 'Saved' }).getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        String(Math.round((carSaved / carTarget) * 100)),
      );
      await expect(stripCell({ page, label: 'Left' })).toContainText(formatGoalAmountUnder100k({ amount: carLeft }));
      const needsShown = parseFirstAmount({ text: await stripCell({ page, label: 'Needs' }).innerText() });
      expect(Math.abs(needsShown - carNeeds)).toBeLessThanOrEqual(1);
      await expect(stripCell({ page, label: 'Pace' })).toContainText(formatGoalAmountUnder100k({ amount: carMonthly }));
      await expect(stripCell({ page, label: 'Pace' })).toContainText(
        `around ${monthYear({ monthsAhead: carEtaMonths })}`,
      );
    });

    await test.step('Deep link /goals/<id> loads directly (plan D9)', async () => {
      await page.goto(`/goals/${holiday.id}`);
      await expect(page.getByRole('heading', { name: 'Holiday', level: 1 })).toBeVisible({ timeout: 15_000 });
      await expect(stripCell({ page, label: 'Target' })).toContainText(
        formatGoalAmountUnder100k({ amount: holidayTarget }),
      );
      await expect(stripCell({ page, label: 'Saved' })).toContainText(
        formatGoalAmountUnder100k({ amount: holidaySaved }),
      );
      await expect(stripCell({ page, label: 'Left' })).toContainText(
        formatGoalAmountUnder100k({ amount: holidayTarget - holidaySaved }),
      );
      await expect(stripCell({ page, label: 'Needs' })).toContainText(/no date/i);
      await expect(stripCell({ page, label: 'Pace' })).toContainText(
        formatGoalAmountUnder100k({ amount: holidayMonthly }),
      );
      await expect(stripCell({ page, label: 'Pace' })).toContainText(
        `around ${monthYear({ monthsAhead: holidayEtaMonths })}`,
      );
    });

    await test.step('Unknown and deleted goal ids show "Goal not found" with a way back', async () => {
      await page.goto(`/goals/${randomUUID()}`);
      await expect(page.getByRole('heading', { name: 'Goal not found' })).toBeVisible({ timeout: 15_000 });

      await deleteGoal({ request, goalId: gift.id });
      await page.goto(`/goals/${gift.id}`);
      await expect(page.getByRole('heading', { name: 'Goal not found' })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('link', { name: 'Back to goals' }).last().click();
      await expect(page).toHaveURL(/\/goals$/);

      await page.goto('/goals/not-a-goal-id');
      await expect(
        page.getByRole('heading', { name: 'Goal not found' }).or(page.getByText("Couldn't load this goal")),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('link', { name: 'Back to goals' }).first()).toBeVisible();
    });

    await test.step('Widget keeps a paused goal and empties once only archived goals remain (docs dashboard#goals)', async () => {
      await updateGoal({ request, goalId: car.id, status: 'archived' });
      await updateGoal({ request, goalId: holiday.id, status: 'archived' });
      await openDashboard({ page });
      await expect(widgetRow({ page, name: 'Rainy day' })).toBeVisible({ timeout: 15_000 });
      await expect(widgetRow({ page, name: 'Car fund' })).toHaveCount(0);
      await expect(widgetRow({ page, name: 'Holiday' })).toHaveCount(0);

      await updateGoal({ request, goalId: rainy.id, status: 'archived' });
      await page.reload();
      await expect(goalsWidget({ page }).getByRole('link', { name: 'Create a goal' })).toBeVisible({
        timeout: 15_000,
      });
    });
  });

  test('phone width: 2-column detail strip and the goal form as a drawer', async ({ page }) => {
    test.setTimeout(180_000);
    const request = page.request;
    await page.setViewportSize(MOBILE_VIEWPORT);

    const savingsBalance = 2_000;
    const firstShare = 50;
    const savingsId = await createAccountOfCategory({
      request,
      name: 'Mobile Savings',
      currencyCode: CURRENCY,
      initialBalance: savingsBalance,
      category: ACCOUNT_CATEGORY.saving,
    });
    const mobileCar = await createGoal({
      request,
      name: 'Mobile car',
      targetAmount: 3_000,
      currencyCode: CURRENCY,
      targetDate: targetDateAhead({ monthsAhead: 12 }).iso,
      plannedMonthly: 100,
      accounts: [{ accountId: savingsId, sharePercent: firstShare }],
    });

    await test.step('Under 448px the strip is Target·Saved / Left·Needs / Pace spanning both columns (plan D13)', async () => {
      await page.goto(`/goals/${mobileCar.id}`);
      await expect(page.getByRole('heading', { name: 'Mobile car', level: 1 })).toBeVisible({ timeout: 15_000 });
      await expect(stripCell({ page, label: 'Saved' })).toContainText(
        formatGoalAmountUnder100k({ amount: (firstShare / 100) * savingsBalance }),
      );

      const [target, saved, left, needs, pace] = await Promise.all(
        STRIP_LABELS.map((label) => boxOf({ locator: stripCell({ page, label }) })),
      );
      expect(Math.abs(target!.y - saved!.y)).toBeLessThan(2);
      expect(saved!.x).toBeGreaterThan(target!.x + target!.width / 2);
      expect(Math.abs(left!.y - needs!.y)).toBeLessThan(2);
      expect(left!.y).toBeGreaterThan(target!.y + target!.height / 2);
      expect(Math.abs(left!.x - target!.x)).toBeLessThan(2);
      expect(Math.abs(needs!.x - saved!.x)).toBeLessThan(2);
      expect(pace!.y).toBeGreaterThan(left!.y + left!.height / 2);
      expect(Math.abs(pace!.width - (target!.width + saved!.width))).toBeLessThan(3);
    });

    await test.step('New goal opens as a bottom drawer and can be completed with a nested accounts drawer (plan D11, docs create-and-edit)', async () => {
      await page.goto('/goals');
      await page.getByRole('button', { name: 'New goal' }).first().click();

      const form = page.getByRole('dialog', { name: 'New goal' });
      await expect(form).toBeVisible();
      await expect.poll(async () => (await boxOf({ locator: form })).width).toBeGreaterThan(MOBILE_VIEWPORT.width - 2);
      await expect
        .poll(async () => {
          const box = await boxOf({ locator: form });
          return Math.abs(box.y + box.height - MOBILE_VIEWPORT.height);
        })
        .toBeLessThan(2);
      await expect(
        form.getByText(
          "Optional. Set a date to see if you're on pace. Without one, we'll estimate when you'll reach it.",
        ),
      ).toBeVisible();

      const phoneTarget = 1_500;
      await form.getByLabel('Name', { exact: true }).fill('Phone');
      await form.getByLabel('Target amount').fill(String(phoneTarget));
      await form.getByRole('button', { name: 'Add accounts' }).click();

      const accounts = page.getByRole('dialog', { name: 'Accounts for Phone' });
      await expect(accounts).toBeVisible();
      await expect
        .poll(async () => {
          const box = await boxOf({ locator: accounts });
          return box.width > MOBILE_VIEWPORT.width - 2 && Math.abs(box.y + box.height - MOBILE_VIEWPORT.height) < 2;
        })
        .toBe(true);
      const freeShare = 100 - firstShare;
      await expect(accounts.getByText(`${freeShare}% free`)).toBeVisible();
      await accounts.getByRole('checkbox', { name: /Mobile Savings/ }).check();
      await expect(accounts.getByRole('spinbutton', { name: 'Share of Mobile Savings' })).toHaveValue(
        String(freeShare),
      );
      await accounts.getByRole('button', { name: 'Done' }).click();
      await expect(accounts).toBeHidden();

      const counted = (freeShare / 100) * savingsBalance;
      // D13: the form keeps full amounts, no compact/whole rounding.
      const countedFull = counted.toLocaleString('en-US', { style: 'currency', currency: CURRENCY });
      await expect(form).toContainText(`Counts ${countedFull} now`);
      await form.getByRole('button', { name: 'Create goal' }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
      const phoneRow = page.getByRole('link', { name: 'Phone', exact: true }).locator('../..');
      await expect(phoneRow).toBeVisible({ timeout: 15_000 });
      await expect(phoneRow).toContainText(formatGoalAmountUnder100k({ amount: counted }));
      await expect(phoneRow).toContainText(`of ${formatGoalAmountUnder100k({ amount: phoneTarget })}`);

      const phone = (await listGoals({ request })).find((goal) => goal.name === 'Phone');
      expect(phone).toBeDefined();
      expect(Number(phone!.targetAmount)).toBe(phoneTarget);
      expect(phone!.currencyCode).toBe(CURRENCY);
      expect(phone!.accounts.map((share) => [share.accountId, Number(share.sharePercent)])).toEqual([
        [savingsId, freeShare],
      ]);
    });
  });
});
