import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

import {
  API_BASE_URL,
  completeOnboarding,
  createAccount,
  createCategory,
  extractId,
  signInViaApi,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';
import { waitForSuccessToast } from '../../helpers/ui';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'cmore' });

const EXPENSE_ACCOUNT = 'Create More Wallet';
const TRANSFER_FROM = 'Create More Checking';
const TRANSFER_TO = 'Create More Savings';
const CATEGORY_NAME = 'Create More Snacks';
const NOTE = 'First entry note';

interface ApiTransaction {
  id: string;
  amount: number;
  accountId: string;
  categoryId: string | null;
  note: string | null;
  time: string;
  paymentType: string;
  transactionType: string;
  transferNature: string;
  transferId: string | null;
}

const toDateInputValue = ({ date }: { date: Date }) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const listAccountTransactions = async ({ api, accountId }: { api: APIRequestContext; accountId: string }) => {
  const res = await api.get(`${API_BASE_URL}/api/v1/transactions?limit=50&accountIds=${accountId}`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return (body.response ?? body) as ApiTransaction[];
};

const getDialogLocators = ({ page }: { page: Page }) => {
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Create transaction' }) });
  return {
    dialog,
    createButton: dialog.getByRole('button', { name: 'Create transaction' }),
    createMoreSwitch: dialog.getByRole('switch', { name: 'Create more' }),
    amountInput: dialog.locator('input[type="number"]').first(),
    accountSelect: dialog.getByRole('combobox').first(),
    toAccountSelect: dialog.getByRole('combobox').nth(1),
    categoryTrigger: dialog.getByRole('button', { name: 'Select category' }),
    noteInput: dialog.locator('textarea'),
    dateInput: dialog.locator('input[type="datetime-local"]'),
  };
};

test.describe.configure({ mode: 'serial' });

test.describe('Create more: keep the Add dialog open between entries', () => {
  let api: APIRequestContext;
  let expenseAccountId: string;
  let transferFromId: string;
  let transferToId: string;
  let categoryId: string;

  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    // Seeded before the first page load: the categories query never refetches (staleTime: Infinity).
    api = await signInViaApi({
      playwright,
      email: creds.email,
      password: creds.password,
    });
    await completeOnboarding({ request: api, currencyCode: CURRENCY });
    expenseAccountId = extractId(
      await createAccount({
        request: api,
        name: EXPENSE_ACCOUNT,
        currencyCode: CURRENCY,
        initialBalance: 1000,
      }),
    );
    transferFromId = extractId(
      await createAccount({
        request: api,
        name: TRANSFER_FROM,
        currencyCode: CURRENCY,
        initialBalance: 1000,
      }),
    );
    transferToId = extractId(
      await createAccount({
        request: api,
        name: TRANSFER_TO,
        currencyCode: CURRENCY,
        initialBalance: 0,
      }),
    );
    // A fresh form defaults to the first root category (unordered from the API), so a subcategory
    // is the only pick guaranteed to differ from that default.
    const categoriesBody = await (await api.get(`${API_BASE_URL}/api/v1/categories`)).json();
    const parent = (
      categoriesBody.response as Array<{
        id: string;
        parentId: string | null;
        type: string;
      }>
    ).find((category) => !category.parentId && category.type !== 'internal')!;
    categoryId = extractId(
      await createCategory({
        request: api,
        name: CATEGORY_NAME,
        parentId: parent.id,
      }),
    );
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    await page.goto('/dashboard');
  });

  const pickCategory = async ({ page }: { page: Page }) => {
    await getDialogLocators({ page }).categoryTrigger.click();
    await page.getByLabel('Search category').fill(CATEGORY_NAME);
    await page.getByRole('option', { name: CATEGORY_NAME }).click();
  };

  test('expense: each save opens a new form with type, account, payment type and date kept', async ({ page }) => {
    const ui = getDialogLocators({ page });
    const paymentTypeSelect = ui.dialog.getByRole('combobox').filter({ hasText: /cash/i });
    const expensePressed = ui.dialog.getByRole('button', {
      name: /select expense/i,
    });
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 3);
    pastDate.setHours(10, 30, 0, 0);
    const pastDateValue = toDateInputValue({ date: pastDate });

    const expectNextEntryForm = async () => {
      await expect(ui.dialog).toBeVisible();
      await expect(ui.amountInput).toHaveValue('');
      await expect(ui.amountInput).toBeFocused();
      await expect(expensePressed).toHaveAttribute('aria-pressed', 'true');
      await expect(ui.accountSelect).toContainText(EXPENSE_ACCOUNT);
      await expect(paymentTypeSelect).toBeVisible();
      await expect(ui.dateInput).toHaveValue(pastDateValue);
      await expect(ui.categoryTrigger).not.toContainText(CATEGORY_NAME);
      await expect(ui.noteInput).toHaveValue('');
      await expect(ui.createMoreSwitch).toBeChecked();
    };

    await page.getByRole('button', { name: 'Add transaction' }).click();
    await expect(ui.dialog).toBeVisible();
    await expect(ui.createMoreSwitch).not.toBeChecked();
    await ui.createMoreSwitch.click();
    await expect(ui.createMoreSwitch).toBeChecked();

    await ui.amountInput.fill('12.5');
    await ui.accountSelect.click();
    await page.getByRole('option', { name: EXPENSE_ACCOUNT }).click();
    await pickCategory({ page });
    await ui.noteInput.fill(NOTE);
    await ui.dialog
      .getByRole('combobox')
      .filter({ hasText: /credit card/i })
      .click();
    await page.getByRole('option', { name: /cash/i }).click();
    await ui.dateInput.fill(pastDateValue);

    await ui.createButton.click();
    await waitForSuccessToast({ page });
    await expectNextEntryForm();

    await ui.amountInput.fill('7.25');
    await pickCategory({ page });
    await ui.createButton.click();
    await expect.poll(async () => (await listAccountTransactions({ api, accountId: expenseAccountId })).length).toBe(2);
    await expectNextEntryForm();

    const transactions = await listAccountTransactions({
      api,
      accountId: expenseAccountId,
    });
    const byAmount = Object.fromEntries(transactions.map((tx) => [Number(tx.amount), tx]));
    expect(Object.keys(byAmount).sort()).toEqual(['12.5', '7.25']);
    for (const tx of transactions) {
      expect(tx.transactionType).toBe('expense');
      expect(tx.transferNature).toBe('not_transfer');
      expect(tx.paymentType).toBe('cash');
      expect(String(tx.categoryId)).toBe(categoryId);
      expect(new Date(tx.time).getTime()).toBe(pastDate.getTime());
    }
    expect(byAmount[12.5]!.note).toBe(NOTE);
    expect(byAmount[7.25]!.note ?? '').toBe('');

    // Reopening resets the toggle; the hotkey still keeps the dialog open for one save.
    await page.keyboard.press('Escape');
    await expect(ui.dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Add transaction' }).click();
    await expect(ui.dialog).toBeVisible();
    await expect(ui.createMoreSwitch).not.toBeChecked();

    await ui.accountSelect.click();
    await page.getByRole('option', { name: EXPENSE_ACCOUNT }).click();
    await pickCategory({ page });
    await ui.amountInput.fill('3');
    await ui.amountInput.press('ControlOrMeta+Shift+Enter');
    await expect.poll(async () => (await listAccountTransactions({ api, accountId: expenseAccountId })).length).toBe(3);
    await expect(ui.dialog).toBeVisible();
    await expect(ui.amountInput).toHaveValue('');
    await expect(ui.accountSelect).toContainText(EXPENSE_ACCOUNT);
    await expect(ui.createMoreSwitch).not.toBeChecked();
  });

  test('transfer: source and destination accounts stay selected across entries', async ({ page }) => {
    const ui = getDialogLocators({ page });
    const transferPressed = ui.dialog.getByRole('button', {
      name: /select transfer/i,
    });

    const expectNextEntryForm = async () => {
      await expect(ui.dialog).toBeVisible();
      await expect(ui.amountInput).toHaveValue('');
      await expect(ui.amountInput).toBeFocused();
      await expect(transferPressed).toHaveAttribute('aria-pressed', 'true');
      await expect(ui.accountSelect).toContainText(TRANSFER_FROM);
      await expect(ui.toAccountSelect).toContainText(TRANSFER_TO);
      await expect(ui.createMoreSwitch).toBeChecked();
    };

    await page.getByRole('button', { name: 'Add transaction' }).click();
    await expect(ui.dialog).toBeVisible();
    await ui.createMoreSwitch.click();
    await transferPressed.click();
    await ui.accountSelect.click();
    await page.getByRole('option', { name: TRANSFER_FROM }).click();
    await ui.toAccountSelect.click();
    await page.getByRole('option', { name: TRANSFER_TO }).click();
    await ui.amountInput.fill('100');

    await ui.createButton.click();
    await waitForSuccessToast({ page });
    await expectNextEntryForm();

    await ui.amountInput.fill('40');
    await ui.createButton.click();
    await expect.poll(async () => (await listAccountTransactions({ api, accountId: transferFromId })).length).toBe(2);
    await expectNextEntryForm();

    const outgoing = await listAccountTransactions({
      api,
      accountId: transferFromId,
    });
    const incoming = await listAccountTransactions({
      api,
      accountId: transferToId,
    });
    expect(incoming).toHaveLength(2);
    expect(outgoing.map((tx) => Number(tx.amount)).sort((a, b) => a - b)).toEqual([40, 100]);

    for (const tx of outgoing) {
      expect(tx.transactionType).toBe('expense');
      expect(tx.transferNature).toBe('transfer_between_user_accounts');
      const pair = incoming.find((item) => item.transferId === tx.transferId);
      expect(pair, `income leg for transfer ${tx.transferId}`).toBeTruthy();
      expect(pair!.transactionType).toBe('income');
      expect(Number(pair!.amount)).toBe(Number(tx.amount));
    }
  });
});
