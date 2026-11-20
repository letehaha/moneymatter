import { type Locator, type Page, expect, test } from '@playwright/test';

import { API_BASE_URL, apiGet, completeOnboarding, createLoan, createVehicle } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import {
  ACCOUNT_CATEGORY,
  type Goal,
  type GoalShare,
  createAccountOfCategory,
  createGoal,
  listGoals,
  updateGoal,
} from '../../helpers/goals';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';

const SAVINGS = {
  name: 'Rainy Savings',
  balance: 5_000,
  creditLimit: 0,
  category: ACCOUNT_CATEGORY.saving,
};
const CASH = {
  name: 'Wallet Cash',
  balance: 1_000,
  creditLimit: 0,
  category: ACCOUNT_CATEGORY.cash,
};
const CURRENT = {
  name: 'Daily Current',
  balance: 2_000,
  creditLimit: 500,
  category: ACCOUNT_CATEGORY.currentAccount,
};
const GENERAL = {
  name: 'Misc General',
  balance: 3_000,
  creditLimit: 0,
  category: ACCOUNT_CATEGORY.general,
};
const INVESTMENT = {
  name: 'Broker Investment',
  balance: 4_000,
  creditLimit: 0,
  category: ACCOUNT_CATEGORY.investment,
};
const CRYPTO = {
  name: 'Cold Crypto',
  balance: 500,
  creditLimit: 0,
  category: ACCOUNT_CATEGORY.crypto,
};
const CARD = {
  name: 'Shiny Card',
  balance: 0,
  creditLimit: 1_000,
  category: ACCOUNT_CATEGORY.creditCard,
};
const ELIGIBLE = [SAVINGS, CASH, CURRENT, GENERAL, INVESTMENT, CRYPTO];
const LOAN_NAME = 'House Loan';
const VEHICLE_NAME = 'Family Sedan';
const INELIGIBLE_NAMES = [CARD.name, LOAN_NAME, VEHICLE_NAME];

type SeedAccount = { balance: number; creditLimit: number };

const FULL = 100;
const counted = ({ account, share }: { account: SeedAccount; share: number }) =>
  (share / FULL) * Math.max(0, account.balance - account.creditLimit);

const HOLIDAY = {
  name: 'Holiday',
  target: 8_000,
  savingsShare: 60,
  currentShare: 50,
};
const HOLIDAY_SAVED =
  counted({ account: SAVINGS, share: HOLIDAY.savingsShare }) +
  counted({ account: CURRENT, share: HOLIDAY.currentShare });

const HOLIDAY_EDIT = {
  name: 'Summer holiday',
  target: 9_000,
  currentShare: 30,
};
const HOLIDAY_EDIT_SAVED =
  counted({ account: SAVINGS, share: HOLIDAY.savingsShare }) +
  counted({ account: CURRENT, share: HOLIDAY_EDIT.currentShare });

const SAVINGS_FREE_AFTER_HOLIDAY = FULL - HOLIDAY.savingsShare;
const CURRENT_FREE_AFTER_HOLIDAY = FULL - HOLIDAY.currentShare;
const EMERGENCY = {
  name: 'Emergency fund',
  target: 6_000,
  savingsShare: SAVINGS_FREE_AFTER_HOLIDAY,
  cashShare: FULL,
};
const EMERGENCY_SAVED =
  counted({ account: SAVINGS, share: EMERGENCY.savingsShare }) + counted({ account: CASH, share: EMERGENCY.cashShare });

const BIKE = { name: 'Bike', target: 1_000 };
const LAPTOP = { name: 'New laptop', target: 2_500 };

const creds = buildTestCredentials({ prefix: 'goals-life' });
const accountIds: Record<string, string> = {};
let dataSeeded = false;

const pad = (n: number) => String(n).padStart(2, '0');
const isoDateInMonths = ({ months }: { months: number }) => {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + months, 15);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const HOLIDAY_DATE = isoDateInMonths({ months: 10 });
const HOLIDAY_EDIT_DATE = isoDateInMonths({ months: 11 });

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const money = ({ amount }: { amount: number }) =>
  new RegExp(`\\$${escapeRegex(amount.toLocaleString('en-US'))}(\\.00)?(?!\\d)`);

const countsText = ({ amount }: { amount: number }) => new RegExp(`counts ${money({ amount }).source}`, 'i');

const DAYS_PER_MONTH = 30.44;
const MS_PER_DAY = 86_400_000;
const neededMonthly = ({ remaining, isoDate }: { remaining: number; isoDate: string }) => {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const daysLeft = (Date.UTC(year, month - 1, day) - today) / MS_PER_DAY;
  return remaining / (daysLeft / DAYS_PER_MONTH);
};
// ponytail: 2% tolerance absorbs display rounding and a ±1 day timezone edge on daysLeft.
const NEEDS_TOLERANCE = 0.02;
const expectNeedsAbout = async ({ row, amount }: { row: Locator; amount: number }) => {
  const needsPattern = /needs (\S+)\/mo/;
  const needs = row.getByText(needsPattern).first();
  await expect(needs).toBeVisible();
  const [, shownText = ''] = ((await needs.textContent()) ?? '').match(needsPattern) ?? [];
  const shown = Number(shownText.replace(/[^\d.]/g, ''));
  expect(Math.abs(shown - amount) / amount).toBeLessThan(NEEDS_TOLERANCE);
};

const goalDialog = ({ page, name }: { page: Page; name: 'New goal' | 'Edit goal' }) =>
  page.getByRole('dialog', { name });
const accountsDialog = ({ page, goalName }: { page: Page; goalName: string }) =>
  page.getByRole('dialog', { name: `Accounts for ${goalName}` });
const accountCheckbox = ({ dialog, name }: { dialog: Locator; name: string }) =>
  dialog.getByRole('checkbox', { name: new RegExp(`^${escapeRegex(name)}`) });
const shareInput = ({ dialog, name }: { dialog: Locator; name: string }) =>
  dialog.getByRole('spinbutton', { name: `Share of ${name}` });

const rowMenuButton = ({ page, name }: { page: Page; name: string }) =>
  page.getByRole('button', { name: `More actions for ${name}`, exact: true });
const goalLink = ({ page, name }: { page: Page; name: string }) => page.getByRole('link', { name, exact: true });
const goalRow = ({ page, name }: { page: Page; name: string }) =>
  page
    .locator('div')
    .filter({ has: goalLink({ page, name }) })
    .filter({ has: rowMenuButton({ page, name }) })
    .last();

const toast = ({ page, text }: { page: Page; text: string }) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text });
const errorToast = ({ page }: { page: Page }) => page.locator('[data-sonner-toast][data-type="error"]');

const pickRowAction = async ({ page, name, action }: { page: Page; name: string; action: string }) => {
  await rowMenuButton({ page, name }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
};

const openGoals = async ({ page }: { page: Page }) => {
  await page.goto('/goals');
  await expect(page.getByRole('heading', { level: 1, name: 'Goals' })).toBeVisible({ timeout: 15_000 });
};

const findGoal = async ({ page, name }: { page: Page; name: string }): Promise<Goal> => {
  const goal = (await listGoals({ request: page.request })).find((item) => item.name === name);
  if (!goal) throw new Error(`Goal "${name}" not found`);
  return goal;
};

const normalizedShares = ({ goal }: { goal: Goal }) =>
  goal.accounts
    .map(({ accountId, sharePercent }) => ({
      accountId,
      sharePercent: Number(sharePercent),
    }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
const expectedShares = ({ shares }: { shares: GoalShare[] }) =>
  [...shares].sort((a, b) => a.accountId.localeCompare(b.accountId));

const postGoalStatus = async ({ page, accounts }: { page: Page; accounts: GoalShare[] }) => {
  const response = await page.request.post(`${API_BASE_URL}/api/v1/goals`, {
    data: {
      name: 'Probe goal',
      targetAmount: 100,
      currencyCode: CURRENCY,
      accounts,
    },
  });
  return response.status();
};

const openNewGoalAccounts = async ({ page, goalName }: { page: Page; goalName: string }) => {
  await page.getByRole('button', { name: 'New goal' }).first().click();
  const form = goalDialog({ page, name: 'New goal' });
  await form.getByLabel('Name', { exact: true }).fill(goalName);
  await form.getByRole('button', { name: 'Add accounts' }).click();
  const dialog = accountsDialog({ page, goalName });
  await expect(dialog).toBeVisible();
  return { form, dialog };
};

const closeNewGoalAccounts = async ({ page, form, dialog }: { page: Page; form: Locator; dialog: Locator }) => {
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

test.describe('Goals lifecycle', () => {
  test.use({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    if (dataSeeded) return;

    const request = page.request;
    await completeOnboarding({ request, currencyCode: CURRENCY });
    for (const account of [...ELIGIBLE, CARD]) {
      accountIds[account.name] = await createAccountOfCategory({
        request,
        name: account.name,
        currencyCode: CURRENCY,
        initialBalance: account.balance,
        category: account.category,
        creditLimit: account.creditLimit,
      });
    }
    await createLoan({
      request,
      name: LOAN_NAME,
      currencyCode: CURRENCY,
      balance: 100_000,
    });
    await createVehicle({
      request,
      name: VEHICLE_NAME,
      currencyCode: CURRENCY,
      purchasePrice: 20_000,
    });

    const { response: allAccounts } = (await apiGet({
      request,
      path: '/api/v1/accounts',
    })) as {
      response: { id: string; name: string }[];
    };
    for (const name of [LOAN_NAME, VEHICLE_NAME]) {
      const account = allAccounts.find((item) => item.name === name);
      if (account) accountIds[name] = account.id;
    }
    dataSeeded = true;
  });

  test('empty state, create form validation, account eligibility and creating a goal', async ({ page }) => {
    test.setTimeout(180_000);
    await openGoals({ page });

    await test.step('empty state and docs link (docs overview, owner decision)', async () => {
      await expect(page.getByText('No goals yet')).toBeVisible();
      await expect(page.getByText('No goals match these filters')).toBeHidden();
      await expect(page.getByRole('link', { name: 'How goals work' })).toHaveAttribute('href', /\/goals\/overview\/?$/);
    });

    const form = goalDialog({ page, name: 'New goal' });

    await test.step('empty-state CTA opens the create form with date hint and base currency (docs create-and-edit)', async () => {
      await page.getByText('No goals yet').locator('..').getByRole('button', { name: 'New goal' }).click();
      await expect(form).toBeVisible();
      await expect(
        form.getByText(
          "Optional. Set a date to see if you're on pace. Without one, we'll estimate when you'll reach it.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(form.getByRole('combobox')).toContainText(CURRENCY);
    });

    await test.step('required fields: name, target above 0, at least one account (docs create-and-edit)', async () => {
      await form.getByRole('button', { name: 'Create goal' }).click();
      await expect(form.getByText('Enter a name')).toBeVisible();
      await expect(form.getByText('Enter an amount above 0')).toBeVisible();
      await expect(form.getByText('Add at least one account')).toBeVisible();

      await form.getByLabel('Name', { exact: true }).fill(HOLIDAY.name);
      await form.getByLabel('Target amount').fill('0');
      await form.getByRole('button', { name: 'Create goal' }).click();
      await expect(form.getByText('Enter a name')).toBeHidden();
      await expect(form.getByText('Enter an amount above 0')).toBeVisible();
      await expect(form).toBeVisible();
      expect(await listGoals({ request: page.request })).toHaveLength(0);
    });

    const dialog = accountsDialog({ page, goalName: HOLIDAY.name });

    await test.step('accounts dialog lists only eligible categories (plan D4, docs create-and-edit)', async () => {
      await form.getByRole('button', { name: 'Add accounts' }).click();
      await expect(dialog).toBeVisible();
      for (const account of ELIGIBLE) {
        const checkbox = accountCheckbox({ dialog, name: account.name });
        await expect(checkbox).toBeVisible();
        await expect(checkbox).toBeEnabled();
        await expect(checkbox).not.toBeChecked();
        await expect(checkbox).not.toHaveAccessibleName(/% free|Fully used/);
      }
      for (const name of INELIGIBLE_NAMES) {
        await expect(dialog.getByText(name)).toHaveCount(0);
      }
    });

    await test.step('share defaults to 100%, inline error for invalid share, Done applies (plan D11)', async () => {
      await accountCheckbox({ dialog, name: SAVINGS.name }).check();
      await expect(shareInput({ dialog, name: SAVINGS.name })).toHaveValue(String(FULL));
      await shareInput({ dialog, name: SAVINGS.name }).fill(String(HOLIDAY.savingsShare));
      await expect(
        dialog
          .getByText(
            countsText({
              amount: counted({
                account: SAVINGS,
                share: HOLIDAY.savingsShare,
              }),
            }),
          )
          .first(),
      ).toBeVisible();

      await accountCheckbox({ dialog, name: CURRENT.name }).check();
      await expect(shareInput({ dialog, name: CURRENT.name })).toHaveValue(String(FULL));
      await shareInput({ dialog, name: CURRENT.name }).fill(String(FULL + 1));
      await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();
      await shareInput({ dialog, name: CURRENT.name }).fill(String(HOLIDAY.currentShare));
      await expect(dialog.getByRole('button', { name: 'Done' })).toBeEnabled();
      await expect(
        dialog
          .getByText(
            countsText({
              amount: counted({
                account: CURRENT,
                share: HOLIDAY.currentShare,
              }),
            }),
          )
          .first(),
      ).toBeVisible();
      await expect(
        dialog.getByText(new RegExp(`^2 accounts · ${countsText({ amount: HOLIDAY_SAVED }).source}`, 'i')),
      ).toBeVisible();

      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();

      for (const [name, share] of [
        [SAVINGS.name, HOLIDAY.savingsShare],
        [CURRENT.name, HOLIDAY.currentShare],
      ] as const) {
        await expect(
          form
            .locator('span')
            .filter({ hasText: name })
            .filter({ hasText: `${share}%` })
            .first(),
        ).toBeVisible();
      }
      await expect(form.getByText(/^Counts .* now$/)).toContainText(money({ amount: HOLIDAY_SAVED }));
      await expect(form.getByRole('button', { name: 'Manage accounts' })).toBeVisible();
    });

    await test.step('create a dated goal without a logo (docs create-and-edit)', async () => {
      await form.getByLabel('Target amount').fill(String(HOLIDAY.target));
      await form.locator('input[type="date"]').fill(HOLIDAY_DATE);
      await form.getByRole('button', { name: 'Create goal' }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
      await expect(toast({ page, text: 'Goal created' })).toBeVisible();

      const row = goalRow({ page, name: HOLIDAY.name });
      await expect(row).toBeVisible();
      await expect(row).toContainText(new RegExp(`of ${money({ amount: HOLIDAY.target }).source}`));
      await expect(row).toContainText(money({ amount: HOLIDAY_SAVED }));
      await expect(page.getByText(/^Active · 1$/)).toBeVisible();
      await expectNeedsAbout({
        row,
        amount: neededMonthly({
          remaining: HOLIDAY.target - HOLIDAY_SAVED,
          isoDate: HOLIDAY_DATE,
        }),
      });

      const goal = await findGoal({ page, name: HOLIDAY.name });
      expect(Number(goal.targetAmount)).toBe(HOLIDAY.target);
      expect(goal.currencyCode).toBe(CURRENCY);
      expect(goal.targetDate).toBe(HOLIDAY_DATE);
      expect(goal.status).toBe('active');
      expect(normalizedShares({ goal })).toEqual(
        expectedShares({
          shares: [
            {
              accountId: accountIds[SAVINGS.name]!,
              sharePercent: HOLIDAY.savingsShare,
            },
            {
              accountId: accountIds[CURRENT.name]!,
              sharePercent: HOLIDAY.currentShare,
            },
          ],
        }),
      );
    });
  });

  test('share capacity, list, edit, pause, archive, unarchive and delete', async ({ page }) => {
    test.setTimeout(300_000);
    await openGoals({ page });

    await test.step('second goal sees only the free share and cannot exceed it (plan D3/D11, docs create-and-edit)', async () => {
      const { form, dialog } = await openNewGoalAccounts({
        page,
        goalName: EMERGENCY.name,
      });

      await expect(accountCheckbox({ dialog, name: SAVINGS.name })).toHaveAccessibleName(
        new RegExp(`${SAVINGS_FREE_AFTER_HOLIDAY}% free`),
      );
      await expect(accountCheckbox({ dialog, name: CURRENT.name })).toHaveAccessibleName(
        new RegExp(`${CURRENT_FREE_AFTER_HOLIDAY}% free`),
      );
      await expect(accountCheckbox({ dialog, name: CASH.name })).not.toHaveAccessibleName(/% free/);

      await accountCheckbox({ dialog, name: SAVINGS.name }).check();
      await expect(shareInput({ dialog, name: SAVINGS.name })).toHaveValue(String(SAVINGS_FREE_AFTER_HOLIDAY));
      await expect(
        dialog.getByText(
          new RegExp(
            `^Max ${SAVINGS_FREE_AFTER_HOLIDAY}% · ${countsText({ amount: counted({ account: SAVINGS, share: SAVINGS_FREE_AFTER_HOLIDAY }) }).source}`,
            'i',
          ),
        ),
      ).toBeVisible();

      await shareInput({ dialog, name: SAVINGS.name }).fill(String(SAVINGS_FREE_AFTER_HOLIDAY + 10));
      await expect(
        dialog.getByText(new RegExp(`^Max ${SAVINGS_FREE_AFTER_HOLIDAY}%( \\(.*\\))?$`)).first(),
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();

      await shareInput({ dialog, name: SAVINGS.name }).fill(String(EMERGENCY.savingsShare));
      await accountCheckbox({ dialog, name: CASH.name }).check();
      await expect(dialog.getByRole('button', { name: 'Done' })).toBeEnabled();
      await expect(
        dialog.getByText(new RegExp(`^2 accounts · ${countsText({ amount: EMERGENCY_SAVED }).source}`, 'i')),
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();

      await form.getByLabel('Target amount').fill(String(EMERGENCY.target));
      await form.getByRole('button', { name: 'Create goal' }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });

      const row = goalRow({ page, name: EMERGENCY.name });
      await expect(row).toContainText(money({ amount: EMERGENCY_SAVED }));
      await expect(row).toContainText('no date');
    });

    await test.step('a fully used account offers a fixed amount only and names its goals (docs create-and-edit)', async () => {
      const { form, dialog } = await openNewGoalAccounts({
        page,
        goalName: 'Probe',
      });
      const savings = accountCheckbox({ dialog, name: SAVINGS.name });
      await expect(savings).toBeEnabled();
      await expect(savings).toHaveAccessibleName(/Fully used: .* · fixed amount only/);
      await expect(savings).toHaveAccessibleName(
        new RegExp(`${HOLIDAY.name}.*${EMERGENCY.name}|${EMERGENCY.name}.*${HOLIDAY.name}`),
      );
      await closeNewGoalAccounts({ page, form, dialog });
    });

    await test.step('API rejects over-capacity and ineligible accounts (plan slice 1, D4)', async () => {
      expect(
        await postGoalStatus({
          page,
          accounts: [{ accountId: accountIds[SAVINGS.name]!, sharePercent: 1 }],
        }),
      ).toBe(409);
      expect(
        await postGoalStatus({
          page,
          accounts: [
            {
              accountId: accountIds[CURRENT.name]!,
              sharePercent: CURRENT_FREE_AFTER_HOLIDAY + 1,
            },
          ],
        }),
      ).toBe(409);
      for (const name of [CARD.name, LOAN_NAME]) {
        expect(
          await postGoalStatus({
            page,
            accounts: [{ accountId: accountIds[name]!, sharePercent: 10 }],
          }),
        ).toBe(422);
      }
      expect((await listGoals({ request: page.request })).map((goal) => goal.name).sort()).toEqual(
        [EMERGENCY.name, HOLIDAY.name].sort(),
      );
    });

    await test.step('reached goal lands in Ended (docs overview, plan D9)', async () => {
      await createGoal({
        request: page.request,
        name: BIKE.name,
        targetAmount: BIKE.target,
        currencyCode: CURRENCY,
        accounts: [{ accountId: accountIds[GENERAL.name]!, sharePercent: FULL }],
      });
      await page.reload();
      await expect(page.getByText(/^Active · 2$/)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/^Ended · 1$/)).toBeVisible();
      const bikeRow = goalRow({ page, name: BIKE.name });
      await expect(bikeRow).toContainText(/reached/i);
      await expect(bikeRow).toContainText(new RegExp(`of ${money({ amount: BIKE.target }).source}`));
      await expect(bikeRow).toContainText(money({ amount: counted({ account: GENERAL, share: FULL }) }));
    });

    await test.step('search and filter chips (docs overview, owner decision)', async () => {
      const search = page.getByRole('searchbox', { name: 'Search goals' });
      await search.fill('emerg');
      await expect(goalLink({ page, name: EMERGENCY.name })).toBeVisible();
      await expect(goalLink({ page, name: HOLIDAY.name })).toBeHidden();
      await expect(goalLink({ page, name: BIKE.name })).toBeHidden();

      await search.fill('zzz');
      await expect(page.getByText('Nothing matches "zzz"')).toBeVisible();
      await expect(page.getByText('No goals yet')).toBeHidden();
      await search.fill('');
      await expect(goalLink({ page, name: HOLIDAY.name })).toBeVisible();

      await page.getByRole('button', { name: /^Behind/ }).click();
      await expect(page.getByText('No goals match these filters')).toBeVisible();
      await expect(goalLink({ page, name: HOLIDAY.name })).toBeHidden();
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await expect(goalLink({ page, name: HOLIDAY.name })).toBeVisible();
    });

    await test.step('row click opens the detail page (plan D9)', async () => {
      const holiday = await findGoal({ page, name: HOLIDAY.name });
      await goalLink({ page, name: HOLIDAY.name }).click();
      await page.waitForURL(new RegExp(`/goals/${holiday.id}$`));
      await expect(page.getByRole('heading', { level: 1, name: HOLIDAY.name })).toBeVisible();
      await page.getByRole('link', { name: 'Back to goals' }).first().click();
      await page.waitForURL(/\/goals$/);
    });

    await test.step('edit name, target, date and shares; changes persist (docs create-and-edit)', async () => {
      await pickRowAction({ page, name: HOLIDAY.name, action: 'Edit' });
      const form = goalDialog({ page, name: 'Edit goal' });
      await expect(form).toBeVisible();
      await expect(form.getByLabel('Name', { exact: true })).toHaveValue(HOLIDAY.name);
      await expect(form.getByLabel('Target amount')).toHaveValue(/^8,?000(\.00)?$/);
      await expect(form.locator('input[type="date"]')).toHaveValue(HOLIDAY_DATE);

      await form.getByLabel('Name', { exact: true }).fill(HOLIDAY_EDIT.name);
      await form.getByLabel('Target amount').fill(String(HOLIDAY_EDIT.target));
      await form.locator('input[type="date"]').fill(HOLIDAY_EDIT_DATE);

      await form.getByRole('button', { name: 'Manage accounts' }).click();
      const dialog = accountsDialog({ page, goalName: HOLIDAY_EDIT.name });
      await expect(dialog).toBeVisible();
      await expect(accountCheckbox({ dialog, name: SAVINGS.name })).toBeChecked();
      await expect(shareInput({ dialog, name: SAVINGS.name })).toHaveValue(String(HOLIDAY.savingsShare));
      await expect(shareInput({ dialog, name: CURRENT.name })).toHaveValue(String(HOLIDAY.currentShare));
      await shareInput({ dialog, name: CURRENT.name }).fill(String(HOLIDAY_EDIT.currentShare));
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();
      await expect(form.getByText(/^Counts .* now$/)).toContainText(money({ amount: HOLIDAY_EDIT_SAVED }));

      await form.getByRole('button', { name: 'Save changes' }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
      await expect(toast({ page, text: 'Goal saved' })).toBeVisible();

      await page.reload();
      const row = goalRow({ page, name: HOLIDAY_EDIT.name });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText(new RegExp(`of ${money({ amount: HOLIDAY_EDIT.target }).source}`));
      await expect(row).toContainText(money({ amount: HOLIDAY_EDIT_SAVED }));
      await expect(goalLink({ page, name: HOLIDAY.name })).toHaveCount(0);
      await expectNeedsAbout({
        row,
        amount: neededMonthly({
          remaining: HOLIDAY_EDIT.target - HOLIDAY_EDIT_SAVED,
          isoDate: HOLIDAY_EDIT_DATE,
        }),
      });

      const goal = await findGoal({ page, name: HOLIDAY_EDIT.name });
      expect(Number(goal.targetAmount)).toBe(HOLIDAY_EDIT.target);
      expect(goal.targetDate).toBe(HOLIDAY_EDIT_DATE);
      expect(normalizedShares({ goal })).toEqual(
        expectedShares({
          shares: [
            {
              accountId: accountIds[SAVINGS.name]!,
              sharePercent: HOLIDAY.savingsShare,
            },
            {
              accountId: accountIds[CURRENT.name]!,
              sharePercent: HOLIDAY_EDIT.currentShare,
            },
          ],
        }),
      );
    });

    await test.step('pause keeps the goal in Active and holds its shares; resume (plan D3, docs create-and-edit)', async () => {
      await pickRowAction({ page, name: HOLIDAY_EDIT.name, action: 'Pause' });
      const row = goalRow({ page, name: HOLIDAY_EDIT.name });
      await expect(row).toContainText('Paused');
      await expect(page.getByText(/^Active · 2$/)).toBeVisible();
      expect((await findGoal({ page, name: HOLIDAY_EDIT.name })).status).toBe('paused');

      const { form, dialog } = await openNewGoalAccounts({
        page,
        goalName: 'Probe',
      });
      await expect(accountCheckbox({ dialog, name: SAVINGS.name })).toHaveAccessibleName(/fixed amount only/);
      await closeNewGoalAccounts({ page, form, dialog });
      expect(
        await postGoalStatus({
          page,
          accounts: [{ accountId: accountIds[SAVINGS.name]!, sharePercent: 1 }],
        }),
      ).toBe(409);

      await pickRowAction({ page, name: HOLIDAY_EDIT.name, action: 'Resume' });
      await expect(row).not.toContainText('Paused');
      await expect(row).toContainText('Not enough history');
      expect((await findGoal({ page, name: HOLIDAY_EDIT.name })).status).toBe('active');
    });

    await test.step('archive moves the goal to a collapsed Archived section and frees its shares (plan D3)', async () => {
      await pickRowAction({ page, name: EMERGENCY.name, action: 'Archive' });
      const archivedHeader = page.getByRole('button', {
        name: /^Archived · 1 · (show|hide)$/,
      });
      await expect(archivedHeader).toHaveAttribute('aria-expanded', 'false');
      await expect(goalLink({ page, name: EMERGENCY.name })).toBeHidden();
      await expect(page.getByText(/^Active · 1$/)).toBeVisible();

      const archivedChip = page.getByRole('button', { name: /^Archived/ }).and(page.locator('[aria-pressed]'));
      await archivedChip.click();
      await expect(archivedChip).toHaveAttribute('aria-pressed', 'true');
      await expect(goalLink({ page, name: EMERGENCY.name })).toBeVisible();
      await archivedChip.click();
      await expect(archivedChip).toHaveAttribute('aria-pressed', 'false');
      await expect(goalLink({ page, name: EMERGENCY.name })).toBeHidden();

      await archivedHeader.click();
      await expect(archivedHeader).toHaveAttribute('aria-expanded', 'true');
      await expect(goalLink({ page, name: EMERGENCY.name })).toBeVisible();
      expect((await findGoal({ page, name: EMERGENCY.name })).status).toBe('archived');

      const { form, dialog } = await openNewGoalAccounts({
        page,
        goalName: 'Probe',
      });
      await expect(accountCheckbox({ dialog, name: SAVINGS.name })).toBeEnabled();
      await expect(accountCheckbox({ dialog, name: SAVINGS.name })).toHaveAccessibleName(
        new RegExp(`${SAVINGS_FREE_AFTER_HOLIDAY}% free`),
      );
      await expect(accountCheckbox({ dialog, name: CASH.name })).not.toHaveAccessibleName(/% free|Fully used/);
      await closeNewGoalAccounts({ page, form, dialog });

      await createGoal({
        request: page.request,
        name: LAPTOP.name,
        targetAmount: LAPTOP.target,
        currencyCode: CURRENCY,
        accounts: [
          {
            accountId: accountIds[SAVINGS.name]!,
            sharePercent: SAVINGS_FREE_AFTER_HOLIDAY,
          },
          { accountId: accountIds[CASH.name]!, sharePercent: FULL },
        ],
      });
    });

    await test.step('unarchive fails with an error toast while the account is full (plan D3, owner decision)', async () => {
      await page.reload();
      const archivedHeader = page.getByRole('button', {
        name: /^Archived · 1 · (show|hide)$/,
      });
      if ((await archivedHeader.getAttribute('aria-expanded')) !== 'true') await archivedHeader.click();
      await expect(goalLink({ page, name: LAPTOP.name })).toBeVisible();

      await pickRowAction({ page, name: EMERGENCY.name, action: 'Unarchive' });
      await expect(errorToast({ page }).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(errorToast({ page }).first()).toContainText(
        new RegExp(`${escapeRegex(SAVINGS.name)}|${escapeRegex(CASH.name)}`),
      );
      await expect(archivedHeader).toBeVisible();
      await expect(goalLink({ page, name: EMERGENCY.name })).toBeVisible();
      expect((await findGoal({ page, name: EMERGENCY.name })).status).toBe('archived');
    });

    await test.step('delete via confirm dialog frees capacity, then unarchive succeeds (docs create-and-edit)', async () => {
      await pickRowAction({ page, name: LAPTOP.name, action: 'Delete' });
      const confirm = page.getByRole('alertdialog');
      await expect(confirm).toContainText('Delete this goal?');
      await confirm.getByRole('button', { name: 'Delete' }).click();
      await expect(confirm).toBeHidden({ timeout: 15_000 });
      await expect(goalLink({ page, name: LAPTOP.name })).toHaveCount(0);
      expect((await listGoals({ request: page.request })).some((goal) => goal.name === LAPTOP.name)).toBe(false);

      await pickRowAction({ page, name: EMERGENCY.name, action: 'Unarchive' });
      await expect(page.getByText(/^Active · 2$/)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole('button', { name: /^Archived · \d+ · (show|hide)$/ })).toHaveCount(0);
      expect((await findGoal({ page, name: EMERGENCY.name })).status).toBe('active');
    });

    await test.step('with only archived goals the regular empty state shows (owner decision)', async () => {
      for (const goal of await listGoals({ request: page.request })) {
        if (goal.status !== 'archived')
          await updateGoal({
            request: page.request,
            goalId: goal.id,
            status: 'archived',
          });
      }
      await page.reload();
      await expect(page.getByText('No goals yet')).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText('No goals match these filters')).toBeHidden();
      await expect(page.getByText(/^Nothing matches/)).toBeHidden();
    });
  });
});
