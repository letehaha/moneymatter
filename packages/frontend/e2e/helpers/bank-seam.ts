import { type APIRequestContext, type Page, expect } from '@playwright/test';
import { format, startOfDay } from 'date-fns';

import { apiGet } from './api-client';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const BANK_TYPE = 'monobank';

export const utcDaysAgo = ({ days, hour }: { days: number; hour: number }) => {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  return new Date(date.getTime() - days * DAY_MS);
};

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const SEAM_AT = utcDaysAgo({ days: 3, hour: 0 });
export const BANK_TIME = utcDaysAgo({ days: 12, hour: 12 });
export const POST_LINK_TIME = utcDaysAgo({ days: 1, hour: 12 });

export const SEAM_LABEL = format(
  SEAM_AT,
  startOfDay(SEAM_AT).getTime() === SEAM_AT.getTime() ? 'dd MMM yyyy' : 'dd MMM yyyy, HH:mm',
);
export const SEAM_DATE_ERROR = new RegExp(`synced with your bank since ${escapeRegExp(SEAM_LABEL)}`);
export const MANUAL_AFTER_LINK_HINT = `This account has been synced with your bank since ${SEAM_LABEL}, so this transaction can't be deleted and its date and amount can no longer change.`;
export const SYNCED_LOCK = "Synced from your bank – this amount can't be changed";
export const SYNCED_LEGS_HINT = 'Only accounts you manage by hand can be added here.';
export const BANK_ACCOUNT_HINT =
  "This account is connected to a bank, so the transaction can't be moved to another account. Everything else on it is yours to change.";

export const toDateTimeInput = ({ date }: { date: Date }) => format(date, "yyyy-MM-dd'T'HH:mm");

export const toCsvDate = ({ date }: { date: Date }) => date.toISOString().slice(0, 10);

export interface ApiTransaction {
  id: string;
  amount: number;
  note: string | null;
  time: string;
}

export const listAccountTransactions = async ({ api, accountId }: { api: APIRequestContext; accountId: string }) => {
  const body = await apiGet({ request: api, path: `/api/v1/transactions?limit=100&accountIds=${accountId}` });
  return (body.response ?? body) as ApiTransaction[];
};

interface FakeBankLinkIds {
  seamAccountId: string;
  bankTxId: string;
  /** Marked bank-linked with no seam, so none of its history is editable. */
  plainBankAccountId?: string;
}

const markBankLinked = ({ node, ids }: { node: unknown; ids: FakeBankLinkIds }): void => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => markBankLinked({ node: item, ids }));
    return;
  }
  const record = node as Record<string, unknown>;
  if ('type' in record && record.id === ids.seamAccountId) {
    Object.assign(record, { type: BANK_TYPE, bankSeamAt: SEAM_AT.toISOString() });
  }
  if (ids.plainBankAccountId && 'type' in record && record.id === ids.plainBankAccountId) {
    Object.assign(record, { type: BANK_TYPE, bankSeamAt: null });
  }
  if ('accountType' in record && record.id === ids.bankTxId) record.accountType = BANK_TYPE;
  Object.values(record).forEach((value) => markBankLinked({ node: value, ids }));
};

// The backend only ever sees plain manual accounts; the browser is told they are bank-linked.
export const fakeBankLink = async ({ page, ...ids }: { page: Page } & FakeBankLinkIds) => {
  await page.route(/\/api\/v1\/(accounts|transactions)(\/|\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    if (!(response.headers()['content-type'] ?? '').includes('application/json')) return route.fulfill({ response });
    const json = await response.json();
    markBankLinked({ node: json, ids });
    await route.fulfill({ response, json });
  });
};

export const openTransactionDialog = async ({ page, rowText }: { page: Page; rowText: string }) => {
  await page.locator('[aria-haspopup="true"]').filter({ hasText: rowText }).first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Edit transaction' }) });
  await expect(dialog).toBeVisible();
  // Every type tab stays disabled until the form finishes loading; an expense row keeps Expense enabled.
  await expect(dialog.getByRole('button', { name: /select expense/i })).toBeEnabled();
  return {
    dialog,
    accountSelect: ({ name }: { name: string }) => dialog.getByRole('combobox').filter({ hasText: name }),
    amountInput: dialog.getByRole('spinbutton', { name: /^Amount/ }),
    dateInput: dialog.locator('input[type="datetime-local"]'),
    incomeTab: dialog.getByRole('button', { name: /select income/i }),
    deleteButton: dialog.getByRole('button', { name: 'Delete transaction' }),
    submitButton: dialog.getByRole('button', { name: 'Edit transaction' }),
    severalAccountsPill: dialog.getByRole('button', { name: 'Several accounts' }),
  };
};

export const uploadCsv = async ({ page, content }: { page: Page; content: string }) => {
  await page.goto('/settings/data-management/import/csv');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'seam-import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(content),
  });
  await page.getByRole('button', { name: 'Continue to mapping' }).click();
  await expect(page.getByRole('heading', { name: 'Map columns' })).toBeVisible();
};

export const assignmentRow = ({ page, field }: { page: Page; field: string }) =>
  page
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: 'How to assign' }) })
    .getByRole('row')
    .filter({ has: page.getByRole('cell').filter({ hasText: new RegExp(`^${field}\\W*$`) }) });

export const assignSingleCategory = async ({ page }: { page: Page }) => {
  const row = assignmentRow({ page, field: 'Category' });
  await row.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Assign all to single existing category' }).click();
  await row.getByText('Select category...').click();
  await page.getByRole('option').first().click();
};

/** Leaves the account dropdown open so the caller can inspect the options before picking one. */
export const openSingleAccountOptions = async ({ page }: { page: Page }) => {
  const row = assignmentRow({ page, field: 'Account' });
  await row.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Assign all to single existing account' }).click();
  await row.getByRole('combobox').nth(1).click();
};

export const assignSingleCurrency = async ({ page, currency }: { page: Page; currency: string }) => {
  const row = assignmentRow({ page, field: 'Currency' });
  await row.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Use same currency for all transactions' }).click();
  await row.getByRole('combobox').nth(1).click();
  await page
    .getByRole('option', { name: new RegExp(currency) })
    .first()
    .click();
};

export const importCsvIntoAccount = async ({
  page,
  content,
  accountName,
  currency,
}: {
  page: Page;
  content: string;
  accountName: string;
  currency: string;
}) => {
  await uploadCsv({ page, content });
  await assignSingleCategory({ page });
  await openSingleAccountOptions({ page });
  await page.getByRole('option', { name: new RegExp(accountName) }).click();
  await assignSingleCurrency({ page, currency });
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /^Import \d+ transactions?/ }).click();
  await expect(page.getByText('Import complete!')).toBeVisible({ timeout: 60_000 });
};
