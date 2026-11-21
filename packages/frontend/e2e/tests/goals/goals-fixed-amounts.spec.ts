import { type Locator, type Page, expect, test } from '@playwright/test';

import { API_BASE_URL, completeOnboarding } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import {
  ACCOUNT_CATEGORY,
  type Goal,
  type GoalLink,
  createAccountOfCategory,
  createGoal,
  listGoals,
} from '../../helpers/goals';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';

const VAULT = { name: 'Vault Savings', balance: 2_000, category: ACCOUNT_CATEGORY.saving };
const SPARE = { name: 'Spare General', balance: 3_000, category: ACCOUNT_CATEGORY.general };
const JOINT = { name: 'Joint Savings', balance: 1_000, category: ACCOUNT_CATEGORY.saving };
const WALLET = { name: 'Wallet Cash', balance: 1_000, category: ACCOUNT_CATEGORY.cash };
const ACCOUNTS = [VAULT, SPARE, JOINT, WALLET];

const DEFAULT_HOLD_DAYS = 30;

const TRIP = { name: 'Trip', target: 5_000, vaultFixed: 1_500, spareShare: 40 };
const TRIP_SPARE_COUNTED = (TRIP.spareShare / 100) * SPARE.balance;
const RAINY = { name: 'Rainy day', target: 1_000, vaultShare: 50 };
const VAULT_LEFT = VAULT.balance - TRIP.vaultFixed;
const RAINY_VAULT_COUNTED = (RAINY.vaultShare / 100) * VAULT_LEFT;

const ALPHA = { name: 'Alpha', target: 5_000, jointFixed: 600 };
const BETA = { name: 'Beta', target: 5_000, jointFixed: 700 };
const FILLER_SHARE = 10;

const BUFFER = { name: 'Buffer', target: 5_000 };
const CUSHION = { name: 'Cushion', target: 2_000, walletFixed: 200, spareShare: 10, holdDays: 45 };
const HOLD_DAYS_OUT_OF_RANGE = 400;

const HOLD_DAYS_LABEL = 'Keep “Reached” after a dip';
const FIXED_BELOW_TARGET =
  'Fixed amounts add up to less than the target. Raise an amount or count an account by percent.';

const creds = buildTestCredentials({ prefix: 'goals-fixed' });
const accountIds: Record<string, string> = {};
let dataSeeded = false;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const money = ({ amount }: { amount: number }) =>
  new RegExp(`\\$${escapeRegex(amount.toLocaleString('en-US'))}(\\.00)?(?!\\d)`);
const countsText = ({ amount }: { amount: number }) => new RegExp(`counts ${money({ amount }).source}`, 'i');
const fixedText = ({ amount }: { amount: number }) => new RegExp(`${money({ amount }).source} fixed`);
const fixedShortText = ({ counted, amount }: { counted: number; amount: number }) =>
  new RegExp(
    `${money({ amount: counted }).source} of ${money({ amount }).source} fixed\\. The account holds less than its fixed amounts\\.`,
  );

const main = ({ page }: { page: Page }) => page.locator('main');
const amountCell = ({ row, amount }: { row: Locator; amount: number }) =>
  row.getByText(new RegExp(`^${money({ amount }).source}$`));
const goalDialog = ({ page, name }: { page: Page; name: 'New goal' | 'Edit goal' }) =>
  page.getByRole('dialog', { name });
const accountsDialog = ({ page, goalName }: { page: Page; goalName: string }) =>
  page.getByRole('dialog', { name: `Accounts for ${goalName}` });
const accountCheckbox = ({ dialog, name }: { dialog: Locator; name: string }) =>
  dialog.getByRole('checkbox', { name: new RegExp(`^${escapeRegex(name)}`) });
const accountBlock = ({ dialog, name }: { dialog: Locator; name: string }) =>
  dialog
    .locator('div.py-3')
    .filter({ has: dialog.page().getByRole('checkbox', { name: new RegExp(`^${escapeRegex(name)}`) }) });
const modeButton = ({ dialog, name, mode }: { dialog: Locator; name: string; mode: 'Percent' | 'Amount' }) =>
  accountBlock({ dialog, name }).getByRole('button', { name: mode, exact: true });
const shareInput = ({ dialog, name }: { dialog: Locator; name: string }) =>
  dialog.getByRole('spinbutton', { name: `Share of ${name}` });
const amountInput = ({ dialog, name }: { dialog: Locator; name: string }) =>
  dialog.getByRole('spinbutton', { name: `Fixed amount from ${name}` });
const holdDaysInput = ({ form }: { form: Locator }) =>
  form.getByText(HOLD_DAYS_LABEL, { exact: true }).locator('..').getByRole('spinbutton');

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

const linkOf = ({ goal, accountName }: { goal: Goal; accountName: string }): GoalLink => {
  const link = goal.accounts.find(({ accountId }) => accountId === accountIds[accountName]);
  if (!link) throw new Error(`Goal "${goal.name}" has no link to "${accountName}"`);
  return link;
};

const openGoalAccountsTab = async ({ page, name }: { page: Page; name: string }) => {
  const goal = await findGoal({ page, name });
  await page.goto(`/goals/${goal.id}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 15_000 });
  await main({ page })
    .getByRole('button', { name: /^Accounts(\s*\d+)?$/ })
    .and(page.locator('[aria-pressed]'))
    .click();
};

// Non-short captions sit under `@2xl/goal:hidden`, so rows are checked by text content, not visibility.
const detailAccountRow = ({ page, name }: { page: Page; name: string }) =>
  main({ page })
    .getByText(name, { exact: true })
    .last()
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " grid ")][1]');

const postGoalStatus = async ({ page, accounts }: { page: Page; accounts: Record<string, unknown>[] }) => {
  const response = await page.request.post(`${API_BASE_URL}/api/v1/goals`, {
    data: { name: 'Probe goal', targetAmount: 100, currencyCode: CURRENCY, accounts },
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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await signUpAndVerify({ creds });
});

test.describe('Goals fixed amounts', () => {
  test.use({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    if (dataSeeded) return;

    const request = page.request;
    await completeOnboarding({ request, currencyCode: CURRENCY });
    for (const account of ACCOUNTS) {
      accountIds[account.name] = await createAccountOfCategory({
        request,
        name: account.name,
        currencyCode: CURRENCY,
        initialBalance: account.balance,
        category: account.category,
      });
    }
    dataSeeded = true;
  });

  test('fixed amount in the accounts dialog, list chip and detail captions', async ({ page }) => {
    test.setTimeout(180_000);
    await openGoals({ page });

    const { form, dialog } = await openNewGoalAccounts({ page, goalName: TRIP.name });

    await test.step('Amount mode asks for an amount above 0 before Done', async () => {
      await expect(
        dialog.getByText(/Fixed amounts come out of an account.s balance first\. Percents split what.s left\./),
      ).toBeVisible();

      await accountCheckbox({ dialog, name: VAULT.name }).check();
      await expect(shareInput({ dialog, name: VAULT.name })).toBeVisible();
      await modeButton({ dialog, name: VAULT.name, mode: 'Amount' }).click();
      await expect(modeButton({ dialog, name: VAULT.name, mode: 'Amount' })).toHaveAttribute('aria-pressed', 'true');
      await expect(shareInput({ dialog, name: VAULT.name })).toHaveCount(0);
      await expect(amountInput({ dialog, name: VAULT.name })).toBeVisible();
      await expect(amountInput({ dialog, name: VAULT.name })).toHaveValue('');
      await expect(dialog.getByText('Enter an amount above 0')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();

      await amountInput({ dialog, name: VAULT.name }).fill('0');
      await expect(dialog.getByText('Enter an amount above 0')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();
    });

    await test.step('a valid amount counts in full; footer adds the percent account', async () => {
      await amountInput({ dialog, name: VAULT.name }).fill(String(TRIP.vaultFixed));
      await expect(dialog.getByText('Enter an amount above 0')).toBeHidden();
      await expect(
        accountBlock({ dialog, name: VAULT.name }).getByText(countsText({ amount: TRIP.vaultFixed })),
      ).toBeVisible();
      await expect(
        dialog.getByText(new RegExp(`^1 account · ${countsText({ amount: TRIP.vaultFixed }).source}`, 'i')),
      ).toBeVisible();

      await accountCheckbox({ dialog, name: SPARE.name }).check();
      await shareInput({ dialog, name: SPARE.name }).fill(String(TRIP.spareShare));
      await expect(
        dialog.getByText(
          new RegExp(`^2 accounts · ${countsText({ amount: TRIP.vaultFixed + TRIP_SPARE_COUNTED }).source}`, 'i'),
        ),
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();
    });

    await test.step('create via the form; API stores the fixed link and the list chip shows the amount', async () => {
      await form.getByLabel('Target amount').fill(String(TRIP.target));
      await form.getByRole('button', { name: 'Create goal' }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
      await expect(toast({ page, text: 'Goal created' })).toBeVisible();

      const goal = await findGoal({ page, name: TRIP.name });
      expect(goal.reachedHoldDays).toBe(DEFAULT_HOLD_DAYS);
      const vault = linkOf({ goal, accountName: VAULT.name });
      expect(Number(vault.fixedAmount)).toBe(TRIP.vaultFixed);
      expect(vault.sharePercent).toBeNull();
      expect(vault.fixedPosition).toBe(0);
      const spare = linkOf({ goal, accountName: SPARE.name });
      expect(Number(spare.sharePercent)).toBe(TRIP.spareShare);
      expect(spare.fixedAmount).toBeNull();

      const row = goalRow({ page, name: TRIP.name });
      await expect(row).toContainText(new RegExp(`${VAULT.name} ${money({ amount: TRIP.vaultFixed }).source}`));
      await expect(row).toContainText(`${SPARE.name} ${TRIP.spareShare}%`);
      await expect(row).toContainText(money({ amount: TRIP.vaultFixed + TRIP_SPARE_COUNTED }));
    });

    await test.step('a percent on the same account splits what the fixed amount leaves', async () => {
      await createGoal({
        request: page.request,
        name: RAINY.name,
        targetAmount: RAINY.target,
        currencyCode: CURRENCY,
        accounts: [{ accountId: accountIds[VAULT.name]!, sharePercent: RAINY.vaultShare }],
      });

      await openGoalAccountsTab({ page, name: TRIP.name });
      const tripVault = detailAccountRow({ page, name: VAULT.name });
      await expect(tripVault).toContainText(
        new RegExp(`Fixed ${money({ amount: TRIP.vaultFixed }).source} from this account`),
      );
      await expect(tripVault).toContainText(fixedText({ amount: TRIP.vaultFixed }));
      await expect(tripVault).not.toContainText('holds less');

      await openGoalAccountsTab({ page, name: RAINY.name });
      const rainyVault = detailAccountRow({ page, name: VAULT.name });
      await expect(rainyVault).toContainText(
        new RegExp(`${RAINY.vaultShare}% of ${money({ amount: VAULT_LEFT }).source} left after fixed amounts`),
      );
      await expect(amountCell({ row: rainyVault, amount: RAINY_VAULT_COUNTED })).toBeVisible();
    });
  });

  test('fixed amounts fill in order; a short account and reordering', async ({ page }) => {
    test.setTimeout(180_000);

    await test.step('a later fixed amount gets what the earlier one leaves', async () => {
      for (const goal of [ALPHA, BETA]) {
        await createGoal({
          request: page.request,
          name: goal.name,
          targetAmount: goal.target,
          currencyCode: CURRENCY,
          accounts: [
            { accountId: accountIds[JOINT.name]!, fixedAmount: goal.jointFixed },
            { accountId: accountIds[SPARE.name]!, sharePercent: FILLER_SHARE },
          ],
        });
      }
      expect(linkOf({ goal: await findGoal({ page, name: ALPHA.name }), accountName: JOINT.name }).fixedPosition).toBe(
        0,
      );
      expect(linkOf({ goal: await findGoal({ page, name: BETA.name }), accountName: JOINT.name }).fixedPosition).toBe(
        1,
      );

      const betaShort = JOINT.balance - ALPHA.jointFixed;
      await openGoalAccountsTab({ page, name: BETA.name });
      const betaJoint = detailAccountRow({ page, name: JOINT.name });
      await expect(betaJoint.getByText(fixedShortText({ counted: betaShort, amount: BETA.jointFixed }))).toBeVisible();
      await expect(amountCell({ row: betaJoint, amount: betaShort })).toBeVisible();

      await openGoalAccountsTab({ page, name: ALPHA.name });
      const alphaJoint = detailAccountRow({ page, name: JOINT.name });
      await expect(alphaJoint).toContainText(fixedText({ amount: ALPHA.jointFixed }));
      await expect(alphaJoint).not.toContainText('holds less');
    });

    await test.step('Move up puts this goal first in the fill order', async () => {
      await openGoals({ page });
      await pickRowAction({ page, name: BETA.name, action: 'Edit' });
      const form = goalDialog({ page, name: 'Edit goal' });
      await expect(form).toBeVisible();
      await form.getByRole('button', { name: 'Manage accounts' }).click();
      const dialog = accountsDialog({ page, goalName: BETA.name });
      await expect(dialog).toBeVisible();

      const order = dialog
        .getByText('If the balance runs short, fixed amounts are filled top to bottom.')
        .locator('..');
      const items = order.locator(':scope > div > div');
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText(ALPHA.name);
      await expect(items.nth(1)).toContainText(`${BETA.name} · this goal`);
      await expect(dialog.getByRole('button', { name: 'Move down' })).toBeDisabled();

      await dialog.getByRole('button', { name: 'Move up' }).click();
      await expect(items.nth(0)).toContainText(`${BETA.name} · this goal`);
      await expect(items.nth(1)).toContainText(ALPHA.name);
      await expect(dialog.getByRole('button', { name: 'Move up' })).toBeDisabled();

      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();
      await form.getByRole('button', { name: 'Save changes' }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
      await expect(toast({ page, text: 'Goal saved' })).toBeVisible();

      expect(linkOf({ goal: await findGoal({ page, name: BETA.name }), accountName: JOINT.name }).fixedPosition).toBe(
        0,
      );
      expect(linkOf({ goal: await findGoal({ page, name: ALPHA.name }), accountName: JOINT.name }).fixedPosition).toBe(
        1,
      );
    });

    await test.step('captions follow the new order', async () => {
      const alphaShort = JOINT.balance - BETA.jointFixed;
      await openGoalAccountsTab({ page, name: BETA.name });
      const betaJoint = detailAccountRow({ page, name: JOINT.name });
      await expect(betaJoint).toContainText(fixedText({ amount: BETA.jointFixed }));
      await expect(betaJoint).not.toContainText('holds less');

      await openGoalAccountsTab({ page, name: ALPHA.name });
      const alphaJoint = detailAccountRow({ page, name: JOINT.name });
      await expect(
        alphaJoint.getByText(fixedShortText({ counted: alphaShort, amount: ALPHA.jointFixed })),
      ).toBeVisible();
      await expect(amountCell({ row: alphaJoint, amount: alphaShort })).toBeVisible();
    });
  });

  test('fixed-only account, all-fixed target check, hold days and API validation', async ({ page }) => {
    test.setTimeout(180_000);
    await createGoal({
      request: page.request,
      name: BUFFER.name,
      targetAmount: BUFFER.target,
      currencyCode: CURRENCY,
      accounts: [{ accountId: accountIds[WALLET.name]!, sharePercent: 100 }],
    });
    await openGoals({ page });

    const { form, dialog } = await openNewGoalAccounts({ page, goalName: CUSHION.name });

    await test.step('an account fully used by percents takes a fixed amount only', async () => {
      const wallet = accountCheckbox({ dialog, name: WALLET.name });
      await expect(wallet).toHaveAccessibleName(/fixed amount only/);
      await expect(wallet).toBeEnabled();
      await wallet.check();
      await expect(amountInput({ dialog, name: WALLET.name })).toBeVisible();

      await modeButton({ dialog, name: WALLET.name, mode: 'Percent' }).click();
      await expect(
        dialog.getByText(new RegExp(`No share left: .*${BUFFER.name}.*\\. Use a fixed amount instead\\.`)),
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();

      await modeButton({ dialog, name: WALLET.name, mode: 'Amount' }).click();
      await amountInput({ dialog, name: WALLET.name }).fill(String(CUSHION.walletFixed));
      await expect(
        accountBlock({ dialog, name: WALLET.name }).getByText(countsText({ amount: CUSHION.walletFixed })),
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();
    });

    await test.step('all-fixed amounts below the target are refused', async () => {
      await form.getByLabel('Target amount').fill(String(CUSHION.target));
      await form.getByRole('button', { name: 'Create goal' }).click();
      await expect(form.getByText(FIXED_BELOW_TARGET, { exact: true })).toBeVisible();
      await expect(form).toBeVisible();
      expect((await listGoals({ request: page.request })).some((goal) => goal.name === CUSHION.name)).toBe(false);
    });

    await test.step('hold days outside 0–365 are refused; a valid value is saved', async () => {
      await form.getByRole('button', { name: 'Manage accounts' }).click();
      await expect(dialog).toBeVisible();
      await accountCheckbox({ dialog, name: SPARE.name }).check();
      await shareInput({ dialog, name: SPARE.name }).fill(String(CUSHION.spareShare));
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();
      await expect(form.getByText(FIXED_BELOW_TARGET, { exact: true })).toBeHidden();

      await expect(holdDaysInput({ form })).toHaveValue(String(DEFAULT_HOLD_DAYS));
      await holdDaysInput({ form }).fill(String(HOLD_DAYS_OUT_OF_RANGE));
      await form.getByRole('button', { name: 'Create goal' }).click();
      await expect(form.getByText('Enter whole days from 0 to 365')).toBeVisible();
      expect((await listGoals({ request: page.request })).some((goal) => goal.name === CUSHION.name)).toBe(false);

      await holdDaysInput({ form }).fill(String(CUSHION.holdDays));
      await expect(form.getByText('Enter whole days from 0 to 365')).toBeHidden();
      await form.getByRole('button', { name: 'Create goal' }).click();
      await expect(form).toBeHidden({ timeout: 15_000 });
      await expect(toast({ page, text: 'Goal created' })).toBeVisible();

      const goal = await findGoal({ page, name: CUSHION.name });
      expect(goal.reachedHoldDays).toBe(CUSHION.holdDays);
      expect(Number(linkOf({ goal, accountName: WALLET.name }).fixedAmount)).toBe(CUSHION.walletFixed);

      await pickRowAction({ page, name: CUSHION.name, action: 'Edit' });
      const edit = goalDialog({ page, name: 'Edit goal' });
      await expect(edit).toBeVisible();
      await expect(holdDaysInput({ form: edit })).toHaveValue(String(CUSHION.holdDays));
      await edit.getByRole('button', { name: 'Cancel' }).click();
      await expect(edit).toBeHidden();
    });

    await test.step('API rejects a link with both kinds, or a position without an amount', async () => {
      const accountId = accountIds[JOINT.name]!;
      expect(await postGoalStatus({ page, accounts: [{ accountId, sharePercent: 5, fixedAmount: 100 }] })).toBe(422);
      expect(await postGoalStatus({ page, accounts: [{ accountId, sharePercent: 5, fixedPosition: 0 }] })).toBe(422);
      expect((await listGoals({ request: page.request })).some((goal) => goal.name === 'Probe goal')).toBe(false);
    });
  });
});
