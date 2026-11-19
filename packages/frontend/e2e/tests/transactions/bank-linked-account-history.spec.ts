import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

import {
  completeOnboarding,
  createAccount,
  createTransaction,
  extractId,
  getTransaction,
  linkTransactions,
  signInViaApi,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import {
  type ApiTransaction,
  BANK_TIME,
  DAY_MS,
  POST_LINK_TIME,
  SEAM_AT,
  SEAM_DATE_ERROR,
  SEAM_LABEL,
  assignSingleCategory,
  assignSingleCurrency,
  escapeRegExp,
  fakeBankLink,
  listAccountTransactions,
  openSingleAccountOptions,
  openTransactionDialog,
  toCsvDate,
  toDateTimeInput,
  uploadCsv,
  utcDaysAgo,
} from '../../helpers/bank-seam';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'bank-seam' });

const SEAM_ACCOUNT = 'Seam Bank Account';
const PLAIN_BANK_ACCOUNT = 'Plain Bank Account';
const CASH_ACCOUNT = 'Cash Wallet';
const DIALOG_PRE_LINK_NOTE = 'Pre-link groceries';
const INLINE_PRE_LINK_NOTE = 'Pre-link pharmacy';
const POST_LINK_NOTE = 'Post-link coffee';
const BULK_DELETE_NOTE = 'Pre-link parking';
const BANK_NOTE = 'Bank card payment';
const TRANSFER_NOTE = 'Cash top-up';

const TRANSFER_TIME = utcDaysAgo({ days: 9, hour: 12 });
const PRE_LINK_TIME = utcDaysAgo({ days: 10, hour: 12 });
const INLINE_PRE_LINK_TIME = utcDaysAgo({ days: 11, hour: 12 });
const BULK_DELETE_TIME = utcDaysAgo({ days: 7, hour: 12 });

const SEAM_SKIPPED_MESSAGE = new RegExp(`on or after ${escapeRegExp(SEAM_LABEL)} was skipped`);
const BALANCE_TOGGLE_LABEL = 'Update account balances from imported transactions';

interface SeededIds {
  seamAccountId: string;
  plainBankAccountId: string;
  cashAccountId: string;
  dialogPreLinkTxId: string;
  inlinePreLinkTxId: string;
  postLinkTxId: string;
  bulkDeleteTxId: string;
  bankTxId: string;
  transferCashTxId: string;
  transferSeamTxId: string;
}

const readTransaction = async ({ api, id }: { api: APIRequestContext; id: string }): Promise<ApiTransaction> => {
  const body = await getTransaction({ request: api, id });
  return body.response ?? body;
};

// The backend sees a plain manual account and skips nothing, so the review step's skip count is injected here.
const simulateSeamSkippedRow = async ({ page }: { page: Page }) => {
  await page.route('**/api/v1/import/csv/detect-duplicates', async (route) => {
    const response = await route.fetch();
    if (!response.ok() || !(response.headers()['content-type'] ?? '').includes('application/json')) {
      return route.fulfill({ response });
    }
    const json = await response.json();
    (json.response ?? json).skippedAfterBankSeam = 1;
    await route.fulfill({ response, json });
  });
  // The store echoes the injected count back; the backend drops 0, so restore that to avoid `bank-link-changed`.
  await page.route('**/api/v1/import/csv/execute', async (route) => {
    const body = route.request().postDataJSON();
    await route.continue({ postData: JSON.stringify({ ...body, skippedAfterBankSeam: 0 }) });
  });
};

test.describe('Bank-linked account: history before the link day stays editable', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  let api: APIRequestContext;
  let ids: SeededIds;

  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    api = await signInViaApi({ playwright, email: creds.email, password: creds.password });
    await completeOnboarding({ request: api, currencyCode: CURRENCY });

    const newAccount = async ({ name }: { name: string }) =>
      extractId(await createAccount({ request: api, name, currencyCode: CURRENCY, initialBalance: 1000 }));
    const seamAccountId = await newAccount({ name: SEAM_ACCOUNT });
    const plainBankAccountId = await newAccount({ name: PLAIN_BANK_ACCOUNT });
    const cashAccountId = await newAccount({ name: CASH_ACCOUNT });

    const seed = async ({
      accountId = seamAccountId,
      amount,
      note,
      time,
      transactionType = 'expense',
    }: {
      accountId?: string;
      amount: number;
      note: string;
      time: Date;
      transactionType?: 'expense' | 'income';
    }) =>
      extractId(
        await createTransaction({
          request: api,
          accountId,
          amount,
          note,
          transactionType,
          time: time.toISOString(),
        }),
      );

    const transferCashTxId = await seed({
      accountId: cashAccountId,
      amount: 60,
      note: TRANSFER_NOTE,
      time: TRANSFER_TIME,
    });
    const transferSeamTxId = await seed({
      amount: 60,
      note: TRANSFER_NOTE,
      time: TRANSFER_TIME,
      transactionType: 'income',
    });
    await linkTransactions({ request: api, ids: [[transferCashTxId, transferSeamTxId]] });

    ids = {
      seamAccountId,
      plainBankAccountId,
      cashAccountId,
      dialogPreLinkTxId: await seed({ amount: 41, note: DIALOG_PRE_LINK_NOTE, time: PRE_LINK_TIME }),
      inlinePreLinkTxId: await seed({ amount: 52, note: INLINE_PRE_LINK_NOTE, time: INLINE_PRE_LINK_TIME }),
      postLinkTxId: await seed({ amount: 17, note: POST_LINK_NOTE, time: POST_LINK_TIME }),
      bulkDeleteTxId: await seed({ amount: 29, note: BULK_DELETE_NOTE, time: BULK_DELETE_TIME }),
      bankTxId: await seed({ amount: 23, note: BANK_NOTE, time: BANK_TIME }),
      transferCashTxId,
      transferSeamTxId,
    };
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await fakeBankLink({
      page,
      seamAccountId: ids.seamAccountId,
      plainBankAccountId: ids.plainBankAccountId,
      bankTxId: ids.bankTxId,
    });
    await loginViaUI({ page, email: creds.email, password: creds.password });
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('dialog: a hand-entered row before the link day is editable but cannot move onto the link day', async ({
    page,
  }) => {
    await page.goto(`/account/${ids.seamAccountId}`);
    const ui = await openTransactionDialog({ page, rowText: DIALOG_PRE_LINK_NOTE });

    await expect(ui.amountInput).toBeEnabled();
    await expect(ui.dateInput).toBeEnabled();
    await expect(ui.incomeTab).toBeEnabled();
    await expect(ui.deleteButton).toBeVisible();
    await expect(ui.accountSelect({ name: SEAM_ACCOUNT })).toBeDisabled();

    await ui.dateInput.fill(toDateTimeInput({ date: POST_LINK_TIME }));
    await ui.submitButton.click();
    await expect(ui.dialog.getByText(SEAM_DATE_ERROR)).toBeVisible();
    await expect(ui.dialog).toBeVisible();
    expect(new Date((await readTransaction({ api, id: ids.dialogPreLinkTxId })).time).getTime()).toBe(
      PRE_LINK_TIME.getTime(),
    );

    await ui.dateInput.fill(toDateTimeInput({ date: PRE_LINK_TIME }));
    await expect(ui.dialog.getByText(SEAM_DATE_ERROR)).toHaveCount(0);
    await ui.amountInput.fill('45');
    await ui.submitButton.click();
    await expect(ui.dialog).not.toBeVisible({ timeout: 10_000 });

    const saved = await readTransaction({ api, id: ids.dialogPreLinkTxId });
    expect(Number(saved.amount)).toBe(45);
    expect(new Date(saved.time).getTime()).toBe(PRE_LINK_TIME.getTime());
  });

  test('dialog: a hand-entered row after the link day is locked and cannot be deleted', async ({ page }) => {
    await page.goto(`/account/${ids.seamAccountId}`);
    const ui = await openTransactionDialog({ page, rowText: POST_LINK_NOTE });

    await expect(ui.amountInput).toBeDisabled();
    await expect(ui.dateInput).toBeDisabled();
    await expect(ui.incomeTab).toBeDisabled();
    await expect(ui.deleteButton).toHaveCount(0);
  });

  test('dialog: a bank-delivered row before the link day stays locked and cannot be deleted', async ({ page }) => {
    await page.goto(`/account/${ids.seamAccountId}`);
    const ui = await openTransactionDialog({ page, rowText: BANK_NOTE });

    await expect(ui.amountInput).toBeDisabled();
    await expect(ui.dateInput).toBeDisabled();
    await expect(ui.incomeTab).toBeDisabled();
    await expect(ui.deleteButton).toHaveCount(0);
  });

  test('dialog: a transfer whose other leg is a pre-link row on the linked account is capped at the link day', async ({
    page,
  }) => {
    await page.goto(`/account/${ids.cashAccountId}`);
    const ui = await openTransactionDialog({ page, rowText: SEAM_ACCOUNT });

    await expect(ui.dialog.getByRole('button', { name: /select transfer/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(ui.accountSelect({ name: CASH_ACCOUNT })).toBeEnabled();
    await expect(ui.accountSelect({ name: SEAM_ACCOUNT })).toBeDisabled();
    await expect(ui.amountInput).toBeEnabled();
    await expect(ui.dateInput).toBeEnabled();
    await expect(ui.deleteButton).toBeVisible();

    await ui.dateInput.fill(toDateTimeInput({ date: POST_LINK_TIME }));
    await ui.submitButton.click();
    await expect(ui.dialog.getByText(SEAM_DATE_ERROR)).toBeVisible();

    await ui.dateInput.fill(toDateTimeInput({ date: TRANSFER_TIME }));
    await expect(ui.dialog.getByText(SEAM_DATE_ERROR)).toHaveCount(0);
    await ui.amountInput.fill('65');
    await ui.submitButton.click();
    await expect(ui.dialog).not.toBeVisible({ timeout: 10_000 });

    for (const id of [ids.transferCashTxId, ids.transferSeamTxId]) {
      const leg = await readTransaction({ api, id });
      expect(Number(leg.amount)).toBe(65);
      expect(new Date(leg.time).getTime()).toBe(TRANSFER_TIME.getTime());
    }
  });

  test('inline table editor: date cell lock and seam error follow the row, a valid earlier date saves', async ({
    page,
  }) => {
    await page.goto('/transactions');
    const cell = ({ txId, column }: { txId: string; column: string }) =>
      page.locator(`[data-inline-cell="${txId}:${column}"]`);
    const editor = ({ name }: { name: string }) => page.getByRole('dialog', { name, exact: true });
    const earlierTime = new Date(INLINE_PRE_LINK_TIME.getTime() - DAY_MS);

    await cell({ txId: ids.inlinePreLinkTxId, column: 'account' }).click();
    const accountLock = editor({ name: 'Connected to a bank' });
    await expect(accountLock).toBeVisible();
    await accountLock.getByRole('button', { name: 'Got it' }).click();
    await expect(accountLock).toHaveCount(0);

    await cell({ txId: ids.inlinePreLinkTxId, column: 'date' }).click();
    const dateEditor = editor({ name: 'Date' });
    const dateInput = dateEditor.locator('input[type="datetime-local"]');
    const saveButton = dateEditor.getByRole('button', { name: 'Save' });
    await expect(dateInput).toBeEnabled();
    await dateInput.fill(toDateTimeInput({ date: POST_LINK_TIME }));
    await expect(dateEditor.getByText(SEAM_DATE_ERROR)).toBeVisible();
    await expect(saveButton).toBeDisabled();
    await dateInput.fill(toDateTimeInput({ date: earlierTime }));
    await expect(dateEditor.getByText(SEAM_DATE_ERROR)).toHaveCount(0);
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(dateEditor).toHaveCount(0);
    await expect
      .poll(async () => new Date((await readTransaction({ api, id: ids.inlinePreLinkTxId })).time).getTime())
      .toBe(earlierTime.getTime());

    await cell({ txId: ids.postLinkTxId, column: 'date' }).click();
    const afterLinkLock = editor({ name: 'Locked since the bank link' });
    await expect(afterLinkLock.getByText(SEAM_DATE_ERROR)).toBeVisible();
    await expect(afterLinkLock.getByText(/date and amount can no longer change/)).toBeVisible();
    await expect(afterLinkLock.locator('input')).toHaveCount(0);
    await afterLinkLock.getByRole('button', { name: 'Got it' }).click();
    await expect(afterLinkLock).toHaveCount(0);

    await cell({ txId: ids.bankTxId, column: 'date' }).click();
    await expect(editor({ name: 'Set by your bank' }).getByText(/sync from your bank connection/)).toBeVisible();
  });

  test('bulk delete: hand-entered rows before the link day can be deleted, later ones and bank rows block the action', async ({
    page,
  }) => {
    await page.goto('/transactions');
    const rowCheckbox = ({ note }: { note: string }) =>
      page.locator('tbody tr[aria-haspopup="true"]').filter({ hasText: note }).getByRole('checkbox');
    const deleteButton = page.getByRole('button', { name: 'Delete', exact: true });

    await rowCheckbox({ note: BULK_DELETE_NOTE }).click();
    await expect(deleteButton).toBeEnabled();

    await rowCheckbox({ note: POST_LINK_NOTE }).click();
    await expect(deleteButton).toBeDisabled();
    await rowCheckbox({ note: POST_LINK_NOTE }).click();
    await expect(deleteButton).toBeEnabled();

    await rowCheckbox({ note: BANK_NOTE }).click();
    await expect(deleteButton).toBeDisabled();
    await deleteButton.locator('..').hover();
    await expect(
      page.getByText(
        'Selection contains transactions synced from your bank, or dated on or after the day the account was linked, which cannot be deleted.',
      ),
    ).toBeVisible();

    await rowCheckbox({ note: BANK_NOTE }).click();
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('1 transaction moved to Trash')).toBeVisible();

    const remainingIds = (await listAccountTransactions({ api, accountId: ids.seamAccountId })).map((tx) => tx.id);
    expect(remainingIds).not.toContain(ids.bulkDeleteTxId);
    expect(remainingIds).toContain(ids.bankTxId);
    expect(remainingIds).toContain(ids.postLinkTxId);
  });

  test('CSV import into the linked account: the account is a target, the review step shows a simulated seam skip count, the import lands', async ({
    page,
  }) => {
    const note = 'Old receipt';
    await simulateSeamSkippedRow({ page });
    await uploadCsv({
      page,
      content: `Date,Amount,Description\n${toCsvDate({ date: PRE_LINK_TIME })},-12.5,${note}\n${toCsvDate({ date: SEAM_AT })},-3.25,Seam day receipt\n`,
    });

    await assignSingleCategory({ page });

    await openSingleAccountOptions({ page });
    await expect(page.getByRole('option', { name: new RegExp(SEAM_ACCOUNT) })).toBeVisible();
    await expect(page.getByRole('option', { name: new RegExp(PLAIN_BANK_ACCOUNT) })).toHaveCount(0);
    await page.getByRole('option', { name: new RegExp(SEAM_ACCOUNT) }).click();

    await assignSingleCurrency({ page, currency: CURRENCY });

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(SEAM_SKIPPED_MESSAGE)).toBeVisible();
    await expect(page.getByText(BALANCE_TOGGLE_LABEL)).toHaveCount(0);

    await page.getByRole('button', { name: /^Import \d+ transactions?/ }).click();
    await expect(page.getByText('Import complete!')).toBeVisible({ timeout: 60_000 });

    const imported = (await listAccountTransactions({ api, accountId: ids.seamAccountId })).find(
      (tx) => tx.note === note,
    );
    expect(imported, 'imported CSV row on the linked account').toBeTruthy();
    expect(Number(imported!.amount)).toBe(12.5);
  });

  test('CSV import with an account column: the linked account is matched by name and the review step shows a simulated seam skip count', async ({
    page,
  }) => {
    await simulateSeamSkippedRow({ page });
    await uploadCsv({
      page,
      content: `Date,Amount,Description,Account,Currency\n${toCsvDate({ date: PRE_LINK_TIME })},-8.75,Column receipt,${SEAM_ACCOUNT},${CURRENCY}\n${toCsvDate({ date: SEAM_AT })},-4.5,Seam day column receipt,${SEAM_ACCOUNT},${CURRENCY}\n`,
    });

    await assignSingleCategory({ page });
    await page.getByRole('button', { name: 'Next' }).click();

    const sourceRow = page.getByRole('row').filter({ has: page.getByText(SEAM_ACCOUNT, { exact: true }) });
    const targetSelect = sourceRow.getByRole('combobox').nth(1);
    await expect(targetSelect).toContainText(SEAM_ACCOUNT);
    await targetSelect.click();
    await expect(page.getByRole('option', { name: new RegExp(SEAM_ACCOUNT) })).toBeVisible();
    await expect(page.getByRole('option', { name: new RegExp(PLAIN_BANK_ACCOUNT) })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(SEAM_SKIPPED_MESSAGE)).toBeVisible();
    await expect(page.getByText(BALANCE_TOGGLE_LABEL)).toHaveCount(0);
  });
});
