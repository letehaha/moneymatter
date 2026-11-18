import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

import {
  apiGet,
  completeOnboarding,
  createAccount,
  createTransaction,
  extractId,
  signInViaApi,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import {
  BANK_ACCOUNT_HINT,
  BANK_TIME,
  MANUAL_AFTER_LINK_HINT,
  POST_LINK_TIME,
  SEAM_AT,
  SEAM_DATE_ERROR,
  SEAM_LABEL,
  SYNCED_LEGS_HINT,
  SYNCED_LOCK,
  fakeBankLink,
  importCsvIntoAccount,
  listAccountTransactions,
  openTransactionDialog,
  toCsvDate,
  toDateTimeInput,
  utcDaysAgo,
} from '../../helpers/bank-seam';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const CURRENCY = 'USD';
const creds = buildTestCredentials({ prefix: 'bank-seam-import' });

const SEAM_ACCOUNT = 'Seam Import Account';
const BANK_NOTE = 'Bank card payment';
const POST_LINK_NOTE = 'Post-link coffee';
const EDIT_NOTE = 'Imported groceries';
const DIALOG_DELETE_NOTE = 'Imported pharmacy';
const BULK_NOTES = ['Imported parking', 'Imported cinema'];
const UNDO_NOTES = ['Undo bakery', 'Undo taxi', 'Undo books'];
const SIMULATED_SKIP_COUNT = 2;

const buildCsv = ({ notes, firstDaysAgo }: { notes: string[]; firstDaysAgo: number }) =>
  [
    'Date,Amount,Description',
    ...notes.map(
      (note, index) =>
        `${toCsvDate({ date: utcDaysAgo({ days: firstDaysAgo + index, hour: 12 }) })},-1${index}.5,${note}`,
    ),
  ].join('\n') + '\n';

const findByNote = async ({ api, accountId, note }: { api: APIRequestContext; accountId: string; note: string }) =>
  (await listAccountTransactions({ api, accountId })).find((tx) => tx.note === note);

const readBalance = async ({ api, accountId }: { api: APIRequestContext; accountId: string }) => {
  const body = await apiGet({ request: api, path: `/api/v1/accounts/${accountId}` });
  return Number((body.response ?? body).currentBalance);
};

// The backend skips nothing for a manual account, so the skip count is injected into the review and result payloads.
// SSE is stubbed so the job's terminal summary arrives through the patched status poll.
const simulateSeamSkip = async ({ page, count }: { page: Page; count: number }) => {
  const patchJson = async ({
    route,
    patch,
  }: {
    route: Parameters<Parameters<Page['route']>[1]>[0];
    patch: (payload: Record<string, unknown>) => void;
  }) => {
    const response = await route.fetch();
    if (!response.ok() || !(response.headers()['content-type'] ?? '').includes('application/json')) {
      return route.fulfill({ response });
    }
    const json = await response.json();
    patch(json.response ?? json);
    await route.fulfill({ response, json });
  };

  await page.route('**/api/v1/import/csv/detect-duplicates', (route) =>
    patchJson({ route, patch: (payload) => (payload.skippedAfterBankSeam = count) }),
  );
  await page.route('**/api/v1/import/csv/execute', async (route) => {
    const body = route.request().postDataJSON();
    await route.continue({ postData: JSON.stringify({ ...body, skippedAfterBankSeam: 0 }) });
  });
  await page.route('**/api/v1/import/csv/execute/status/**', (route) =>
    patchJson({
      route,
      patch: (payload) => {
        if (payload.status === 'completed') (payload.summary as Record<string, unknown>).skippedAfterBankSeam = count;
      },
    }),
  );
  await page.route('**/api/v1/sse/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  );
};

test.describe('Bank-linked account: importing history from before the link day', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: { width: 1440, height: 900 } });

  let api: APIRequestContext;
  let seamAccountId: string;
  let bankTxId: string;

  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    api = await signInViaApi({ playwright, email: creds.email, password: creds.password });
    await completeOnboarding({ request: api, currencyCode: CURRENCY });

    seamAccountId = extractId(
      await createAccount({ request: api, name: SEAM_ACCOUNT, currencyCode: CURRENCY, initialBalance: 1000 }),
    );
    const seed = async ({ amount, note, time }: { amount: number; note: string; time: Date }) =>
      extractId(
        await createTransaction({
          request: api,
          accountId: seamAccountId,
          amount,
          note,
          transactionType: 'expense',
          time: time.toISOString(),
        }),
      );
    bankTxId = await seed({ amount: 23, note: BANK_NOTE, time: BANK_TIME });
    await seed({ amount: 17, note: POST_LINK_NOTE, time: POST_LINK_TIME });
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await fakeBankLink({ page, seamAccountId, bankTxId });
    await loginViaUI({ page, email: creds.email, password: creds.password });
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('CSV import: the result step reports a simulated seam skip count with the link day and the imported rows land', async ({
    page,
  }) => {
    test.slow();
    const notes = [EDIT_NOTE, DIALOG_DELETE_NOTE, ...BULK_NOTES];
    await simulateSeamSkip({ page, count: SIMULATED_SKIP_COUNT });
    await importCsvIntoAccount({
      page,
      content: buildCsv({ notes, firstDaysAgo: 6 }),
      accountName: SEAM_ACCOUNT,
      currency: CURRENCY,
    });

    await expect(page.getByText(`${notes.length} transactions imported successfully`)).toBeVisible();
    await expect(
      page.getByText(
        `${SIMULATED_SKIP_COUNT} rows dated on or after ${SEAM_LABEL} were skipped: the bank connection already provides transactions from that day.`,
      ),
    ).toBeVisible();

    const importedNotes = (await listAccountTransactions({ api, accountId: seamAccountId })).map((tx) => tx.note);
    expect(importedNotes).toEqual(expect.arrayContaining(notes));
  });

  test('imported rows: listed on the account page, editable before the link day, deletable from the dialog', async ({
    page,
  }) => {
    await page.goto(`/account/${seamAccountId}`);
    for (const note of [EDIT_NOTE, DIALOG_DELETE_NOTE, ...BULK_NOTES]) {
      await expect(page.locator('[aria-haspopup="true"]').filter({ hasText: note }).first()).toBeVisible();
    }

    const original = await findByNote({ api, accountId: seamAccountId, note: EDIT_NOTE });
    expect(original, 'imported row to edit').toBeTruthy();
    const originalTime = new Date(original!.time);

    const edit = await openTransactionDialog({ page, rowText: EDIT_NOTE });
    await expect(edit.amountInput).toBeEnabled();
    await expect(edit.dateInput).toBeEnabled();
    await expect(edit.deleteButton).toBeVisible();

    await edit.dateInput.fill(toDateTimeInput({ date: SEAM_AT }));
    await edit.submitButton.click();
    await expect(edit.dialog.getByText(SEAM_DATE_ERROR)).toBeVisible();
    await expect(edit.dialog).toBeVisible();

    await edit.dateInput.fill(toDateTimeInput({ date: originalTime }));
    await expect(edit.dialog.getByText(SEAM_DATE_ERROR)).toHaveCount(0);
    await edit.amountInput.fill('31');
    await edit.submitButton.click();
    await expect(edit.dialog).not.toBeVisible({ timeout: 10_000 });

    const saved = await findByNote({ api, accountId: seamAccountId, note: EDIT_NOTE });
    expect(Number(saved!.amount)).toBe(31);
    expect(Math.abs(new Date(saved!.time).getTime() - originalTime.getTime())).toBeLessThan(60_000);

    const remove = await openTransactionDialog({ page, rowText: DIALOG_DELETE_NOTE });
    await remove.deleteButton.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(remove.dialog).not.toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => (await findByNote({ api, accountId: seamAccountId, note: DIALOG_DELETE_NOTE }))?.id)
      .toBeUndefined();
  });

  test('bulk delete: imported rows before the link day go together, a bank row in the selection blocks it', async ({
    page,
  }) => {
    await page.goto('/transactions');
    const rowCheckbox = ({ note }: { note: string }) =>
      page.locator('tbody tr[aria-haspopup="true"]').filter({ hasText: note }).getByRole('checkbox');
    const deleteButton = page.getByRole('button', { name: 'Delete', exact: true });

    for (const note of BULK_NOTES) await rowCheckbox({ note }).click();
    await expect(deleteButton).toBeEnabled();

    await rowCheckbox({ note: BANK_NOTE }).click();
    await expect(deleteButton).toBeDisabled();
    await rowCheckbox({ note: BANK_NOTE }).click();
    await expect(deleteButton).toBeEnabled();

    await deleteButton.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(`${BULK_NOTES.length} transactions moved to Trash`)).toBeVisible();

    const remainingNotes = (await listAccountTransactions({ api, accountId: seamAccountId })).map((tx) => tx.note);
    for (const note of BULK_NOTES) expect(remainingNotes).not.toContain(note);
    expect(remainingNotes).toContain(BANK_NOTE);
  });

  test('locked rows explain themselves in the dialog: hand-entered after the link, bank-delivered, and the bank account', async ({
    page,
  }) => {
    await page.goto(`/account/${seamAccountId}`);

    const afterLink = await openTransactionDialog({ page, rowText: POST_LINK_NOTE });
    await expect(afterLink.dialog.getByText(MANUAL_AFTER_LINK_HINT)).toBeVisible();
    await expect(afterLink.amountInput).toBeDisabled();
    await expect(afterLink.deleteButton).toHaveCount(0);
    await afterLink.severalAccountsPill.click();
    await expect(afterLink.dialog.getByRole('button', { name: MANUAL_AFTER_LINK_HINT })).toBeVisible();
    await page.goto(`/account/${seamAccountId}`);

    const bank = await openTransactionDialog({ page, rowText: BANK_NOTE });
    await expect(bank.dialog.getByText(MANUAL_AFTER_LINK_HINT)).toHaveCount(0);
    await bank.severalAccountsPill.click();
    await expect(bank.dialog.getByRole('button', { name: SYNCED_LOCK })).toBeVisible();
    await expect(bank.dialog.getByText(SYNCED_LEGS_HINT)).toBeVisible();
    await page.goto(`/account/${seamAccountId}`);

    const imported = await openTransactionDialog({ page, rowText: EDIT_NOTE });
    await imported.severalAccountsPill.click();
    const removeMainRow = imported.dialog.getByRole('button', { name: BANK_ACCOUNT_HINT });
    await expect(removeMainRow).toBeDisabled();
    // A disabled button takes no pointer events, so the hover lands on the wrapping span, the tooltip trigger.
    await removeMainRow.hover({ force: true });
    await expect(page.getByText(BANK_ACCOUNT_HINT).filter({ visible: true }).first()).toBeVisible();
  });

  test('undo the import from import history: its rows go and the balance returns', async ({ page }) => {
    test.slow();
    const balanceBefore = await readBalance({ api, accountId: seamAccountId });

    await importCsvIntoAccount({
      page,
      content: buildCsv({ notes: UNDO_NOTES, firstDaysAgo: 14 }),
      accountName: SEAM_ACCOUNT,
      currency: CURRENCY,
    });
    await expect(page.getByText(`${UNDO_NOTES.length} transactions imported successfully`)).toBeVisible();
    const importedNotes = (await listAccountTransactions({ api, accountId: seamAccountId })).map((tx) => tx.note);
    expect(importedNotes).toEqual(expect.arrayContaining(UNDO_NOTES));

    await page.goto('/settings/data-management/import/history');
    await page
      .getByRole('listitem')
      .filter({ hasText: new RegExp(`(^|\\D)${UNDO_NOTES.length} transactions\\b`) })
      .getByRole('button', { name: 'Delete import' })
      .click();
    const confirm = page.getByRole('alertdialog');
    await expect(
      confirm.getByText(`This will permanently delete ${UNDO_NOTES.length} transactions from this import.`),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete import' }).click();
    await expect(page.getByText(`Deleted ${UNDO_NOTES.length} transactions`)).toBeVisible({ timeout: 30_000 });

    const remainingNotes = async () =>
      (await listAccountTransactions({ api, accountId: seamAccountId })).map((tx) => tx.note);
    await expect
      .poll(async () => (await remainingNotes()).filter((note) => UNDO_NOTES.includes(note ?? '')), { timeout: 30_000 })
      .toEqual([]);
    expect(await remainingNotes()).toEqual(expect.arrayContaining([EDIT_NOTE, BANK_NOTE, POST_LINK_NOTE]));
    await expect.poll(() => readBalance({ api, accountId: seamAccountId })).toBe(balanceBefore);

    await page.goto(`/account/${seamAccountId}`);
    await expect(page.locator('[aria-haspopup="true"]').filter({ hasText: EDIT_NOTE }).first()).toBeVisible();
    for (const note of UNDO_NOTES) {
      await expect(page.locator('[aria-haspopup="true"]').filter({ hasText: note })).toHaveCount(0);
    }
  });
});
