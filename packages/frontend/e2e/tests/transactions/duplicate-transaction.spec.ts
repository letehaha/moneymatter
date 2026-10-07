import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

import {
  API_BASE_URL,
  apiPost,
  completeOnboarding,
  createAccount,
  createCategory,
  createTransaction,
  extractId,
  signInViaApi,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'dup' });

const SOURCE_ACCOUNT = 'Duplicate Wallet';
const DESTINATION_ACCOUNT = 'Duplicate Savings';
const CATEGORY_NAME = 'Duplicate Groceries';
const NOTE = 'Weekly groceries';
const EXPENSE_AMOUNT = 33.4;
const TRANSFER_AMOUNT = 120;
const TEN_MINUTES = 10 * 60 * 1000;

interface ApiTransaction {
  id: string;
  amount: number;
  accountId: string;
  categoryId: string | null;
  note: string | null;
  time: string;
  transactionType: string;
  transferNature: string;
  transferId: string | null;
}

const daysAgo = ({ days }: { days: number }) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(9, 15, 0, 0);
  return date;
};

const toLocalDay = ({ date }: { date: Date }) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const listAccountTransactions = async ({ api, accountId }: { api: APIRequestContext; accountId: string }) => {
  const res = await api.get(`${API_BASE_URL}/api/v1/transactions?limit=50&accountIds=${accountId}`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return (body.response ?? body) as ApiTransaction[];
};

const getDialogs = ({ page }: { page: Page }) => {
  const editDialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Edit transaction' }) });
  const addDialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Create transaction' }) });
  return {
    editDialog,
    duplicateButton: editDialog.getByRole('button', { name: 'Duplicate' }),
    addDialog,
    amountInput: addDialog.locator('input[type="number"]').first(),
    accountSelect: addDialog.getByRole('combobox').first(),
    toAccountSelect: addDialog.getByRole('combobox').nth(1),
    dateInput: addDialog.locator('input[type="datetime-local"]'),
  };
};

test.describe.configure({ mode: 'serial' });

test.describe('Duplicate an existing transaction from the edit dialog', () => {
  let api: APIRequestContext;
  let sourceAccountId: string;
  let destinationAccountId: string;
  let categoryId: string;
  let originalExpense: ApiTransaction;
  let originalTransferTime: Date;

  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    api = await signInViaApi({ playwright, email: creds.email, password: creds.password });
    await completeOnboarding({ request: api, currencyCode: CURRENCY });
    sourceAccountId = extractId(
      await createAccount({ request: api, name: SOURCE_ACCOUNT, currencyCode: CURRENCY, initialBalance: 1000 }),
    );
    destinationAccountId = extractId(
      await createAccount({ request: api, name: DESTINATION_ACCOUNT, currencyCode: CURRENCY, initialBalance: 0 }),
    );
    categoryId = extractId(await createCategory({ request: api, name: CATEGORY_NAME, color: '#5b8f34' }));

    const expenseId = extractId(
      await createTransaction({
        request: api,
        accountId: sourceAccountId,
        amount: EXPENSE_AMOUNT,
        categoryId,
        note: NOTE,
        time: daysAgo({ days: 5 }).toISOString(),
      }),
    );
    originalExpense = (await listAccountTransactions({ api, accountId: sourceAccountId })).find(
      (tx) => tx.id === expenseId,
    )!;

    originalTransferTime = daysAgo({ days: 4 });
    await apiPost({
      request: api,
      path: '/api/v1/transactions',
      data: {
        accountId: sourceAccountId,
        amount: TRANSFER_AMOUNT,
        destinationAccountId,
        destinationAmount: TRANSFER_AMOUNT,
        transactionType: 'expense',
        transferNature: 'transfer_between_user_accounts',
        paymentType: 'bankTransfer',
        time: originalTransferTime.toISOString(),
      },
    });
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
    await page.goto(`/account/${sourceAccountId}`);
  });

  test('Duplicate button opens a prefilled Add dialog that creates a new expense', async ({ page }) => {
    const ui = getDialogs({ page });

    await page.locator('[aria-haspopup="true"]').filter({ hasText: CATEGORY_NAME }).first().click();
    await expect(ui.duplicateButton).toBeEnabled();
    await ui.duplicateButton.click();

    await expect(ui.addDialog).toBeVisible();
    await expect(ui.editDialog).not.toBeVisible();
    await expect(ui.addDialog.getByRole('button', { name: /select expense/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(ui.amountInput).toHaveValue(String(EXPENSE_AMOUNT));
    await expect(ui.accountSelect).toContainText(SOURCE_ACCOUNT);
    await expect(ui.addDialog.getByRole('button', { name: 'Select category' })).toContainText(CATEGORY_NAME);
    await expect(ui.addDialog.locator('textarea')).toHaveValue(NOTE);
    await expect(ui.dateInput).toHaveValue(new RegExp(`^${toLocalDay({ date: new Date() })}T`));

    await ui.addDialog.getByRole('button', { name: 'Create transaction' }).click();
    await expect(ui.addDialog).not.toBeVisible({ timeout: 10_000 });

    const expenses = (await listAccountTransactions({ api, accountId: sourceAccountId })).filter(
      (tx) => tx.transferNature === 'not_transfer',
    );
    expect(expenses).toHaveLength(2);
    for (const tx of expenses) {
      expect(Number(tx.amount)).toBe(EXPENSE_AMOUNT);
      expect(String(tx.categoryId)).toBe(categoryId);
      expect(tx.note).toBe(NOTE);
      expect(tx.transactionType).toBe('expense');
    }

    const original = expenses.find((tx) => tx.id === originalExpense.id)!;
    expect(original.time).toBe(originalExpense.time);
    const copy = expenses.find((tx) => tx.id !== originalExpense.id)!;
    expect(Math.abs(new Date(copy.time).getTime() - Date.now())).toBeLessThan(TEN_MINUTES);
  });

  test('Cmd/Ctrl+D duplicates a transfer between own accounts into a new linked pair', async ({ page }) => {
    const ui = getDialogs({ page });

    await page.locator('[aria-haspopup="true"]').filter({ hasText: DESTINATION_ACCOUNT }).first().click();
    await expect(ui.duplicateButton).toBeEnabled();
    await page.keyboard.press('ControlOrMeta+d');

    await expect(ui.addDialog).toBeVisible();
    await expect(ui.editDialog).not.toBeVisible();
    await expect(ui.addDialog.getByRole('button', { name: /select transfer/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(ui.amountInput).toHaveValue(String(TRANSFER_AMOUNT));
    await expect(ui.accountSelect).toContainText(SOURCE_ACCOUNT);
    await expect(ui.toAccountSelect).toContainText(DESTINATION_ACCOUNT);

    await ui.addDialog.getByRole('button', { name: 'Create transaction' }).click();
    await expect(ui.addDialog).not.toBeVisible({ timeout: 10_000 });

    const outgoing = (await listAccountTransactions({ api, accountId: sourceAccountId })).filter(
      (tx) => tx.transferNature === 'transfer_between_user_accounts',
    );
    const incoming = (await listAccountTransactions({ api, accountId: destinationAccountId })).filter(
      (tx) => tx.transferNature === 'transfer_between_user_accounts',
    );
    expect(outgoing).toHaveLength(2);
    expect(incoming).toHaveLength(2);
    expect(new Set(outgoing.map((tx) => tx.transferId)).size).toBe(2);

    for (const tx of outgoing) {
      expect(tx.transactionType).toBe('expense');
      expect(Number(tx.amount)).toBe(TRANSFER_AMOUNT);
      const pair = incoming.find((item) => item.transferId === tx.transferId);
      expect(pair, `income leg for transfer ${tx.transferId}`).toBeTruthy();
      expect(pair!.transactionType).toBe('income');
      expect(Number(pair!.amount)).toBe(TRANSFER_AMOUNT);
    }

    const [original, copy] = [...outgoing].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    expect(new Date(original!.time).getTime()).toBe(originalTransferTime.getTime());
    expect(Math.abs(new Date(copy!.time).getTime() - Date.now())).toBeLessThan(TEN_MINUTES);
  });
});
