import { type APIRequestContext, type Locator, type Page, expect, test } from '@playwright/test';

import {
  API_BASE_URL,
  addUserCurrencies,
  completeOnboarding,
  createAccount,
  createTransaction,
  extractId,
  signInViaApi,
} from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const creds = buildTestCredentials({ prefix: 'map' });

const MAIN = 'Map Main';
const SECOND = 'Map Second';
const THIRD = 'Map Third';
const FOURTH = 'Map Fourth';
const FIFTH = 'Map Fifth';
const SIXTH = 'Map Sixth';
const EURO = 'Map Euro';

const NEAR_NOTE = 'Linkable near';
const SECOND_NEAR_NOTE = 'Linkable second';
const FAR_NOTE = 'Linkable far';
const INCOME_NOTE = 'Near income';

const daysAgo = ({ days }: { days: number }) => new Date(Date.now() - days * 86_400_000).toISOString();

const getDialog = ({ page }: { page: Page }) => {
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Several accounts' }) });
  return {
    dialog,
    severalAccounts: dialog.getByRole('button', { name: 'Several accounts' }),
    total: dialog.getByRole('textbox', { name: 'Amount USD' }),
    amounts: dialog.getByRole('spinbutton', { name: 'Amount', exact: true }),
    accounts: dialog.getByRole('combobox'),
    share: dialog.getByRole('spinbutton', { name: 'Amount in USD' }),
    removeButtons: dialog.getByRole('button', { name: 'Remove account' }),
    addAccount: dialog.getByRole('button', { name: 'Add account' }),
    linkExisting: dialog.getByRole('button', { name: 'Link existing' }),
    createButton: dialog.getByRole('button', { name: 'Create transaction' }),
    saveButton: dialog.getByRole('button', { name: 'Edit transaction' }),
    note: dialog.getByRole('textbox', { name: 'Note' }),
  };
};

const sidebarBalance = ({ page, name, balance }: { page: Page; name: string; balance: string }) =>
  page.getByRole('link', { name: `${name} ${balance}`, exact: true });

const listRows = ({ page }: { page: Page }) => page.locator('[aria-haspopup="true"]');

const openGlobalList = async ({ page, view }: { page: Page; view: 'List view' | 'Table view' }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: view }).click();
};

const pickPartAccount = async ({ page, nth, name }: { page: Page; nth: number; name: string }) => {
  await getDialog({ page }).accounts.nth(nth).click();
  await option({ page, name }).click();
};

const openNewMultiAccountDialog = async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const ui = getDialog({ page });
  await ui.severalAccounts.click();
  await expect(ui.severalAccounts).toHaveAttribute('aria-pressed', 'true');
  await pickPartAccount({ page, nth: 0, name: MAIN });
  return ui;
};

const option = ({ page, name }: { page: Page; name: string }) =>
  page.getByRole('option', { name: new RegExp(`^${name}`) });

const linkCandidate = ({ picker, note }: { picker: Locator; note: string }) =>
  picker
    .locator('label, li, [role="option"], div')
    .filter({ hasText: note })
    .filter({ has: picker.page().getByRole('checkbox') })
    .last()
    .getByRole('checkbox');

const countTransactions = async ({ api }: { api: APIRequestContext }) => {
  const res = await api.get(`${API_BASE_URL}/api/v1/transactions?limit=100`);
  const body = await res.json();
  return (body.response ?? body).length as number;
};

const expectSaveBlocked = async ({ page, api, before }: { page: Page; api: APIRequestContext; before: number }) => {
  const ui = getDialog({ page });
  if (await ui.createButton.isEnabled()) await ui.createButton.click();
  await page.waitForTimeout(1_500);
  expect(await countTransactions({ api })).toBe(before);
  await expect(ui.dialog).toBeVisible();
};

test.describe.configure({ mode: 'serial' });

test.describe('Multi-account payments', () => {
  let api: APIRequestContext;
  const accountIds: Record<string, string> = {};

  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    api = await signInViaApi({ playwright, email: creds.email, password: creds.password });
    await completeOnboarding({ request: api, currencyCode: 'USD' });
    await addUserCurrencies({ request: api, currencyCode: 'EUR' });
    for (const name of [MAIN, SECOND, THIRD, FOURTH, FIFTH, SIXTH]) {
      accountIds[name] = extractId(
        await createAccount({ request: api, name, currencyCode: 'USD', initialBalance: 1000 }),
      );
    }
    accountIds[EURO] = extractId(
      await createAccount({ request: api, name: EURO, currencyCode: 'EUR', initialBalance: 1000 }),
    );

    await createTransaction({
      request: api,
      accountId: accountIds[THIRD]!,
      amount: 7.5,
      note: NEAR_NOTE,
      time: daysAgo({ days: 1 }),
    });
    await createTransaction({
      request: api,
      accountId: accountIds[FIFTH]!,
      amount: 4.25,
      note: SECOND_NEAR_NOTE,
      time: daysAgo({ days: 2 }),
    });
    await createTransaction({
      request: api,
      accountId: accountIds[FOURTH]!,
      amount: 8.4,
      note: FAR_NOTE,
      time: daysAgo({ days: 10 }),
    });
    await createTransaction({
      request: api,
      accountId: accountIds[THIRD]!,
      amount: 9.6,
      transactionType: 'income',
      note: INCOME_NOTE,
      time: daysAgo({ days: 1 }),
    });
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await loginViaUI({ page, email: creds.email, password: creds.password });
  });

  test('creates an expense paid from three accounts, one in another currency', async ({ page }) => {
    const ui = await openNewMultiAccountDialog({ page });

    await expect(ui.total).not.toBeEditable();
    await ui.amounts.nth(0).fill('10.1');
    await pickPartAccount({ page, nth: 1, name: SECOND });
    await ui.amounts.nth(1).fill('5.25');
    await expect(ui.total).toHaveValue('15.35');

    await ui.addAccount.click();
    await pickPartAccount({ page, nth: 2, name: EURO });
    await ui.amounts.nth(2).fill('20');
    await expect(ui.share).not.toHaveValue('');
    const prefilled = Number(await ui.share.inputValue());
    expect(prefilled).toBeGreaterThan(0);
    expect(Number(await ui.total.inputValue())).toBeCloseTo(15.35 + prefilled, 2);

    await ui.share.fill('25');
    await expect(ui.total).toHaveValue('40.35');

    await ui.createButton.click();
    await expect(ui.dialog).toBeHidden();

    await expect(sidebarBalance({ page, name: MAIN, balance: '$989.90' })).toBeVisible();
    await expect(sidebarBalance({ page, name: SECOND, balance: '$994.75' })).toBeVisible();
    await expect(sidebarBalance({ page, name: EURO, balance: '€980.00' })).toBeVisible();
  });

  test('global list (list view) shows the payment as one row with the total and an indicator', async ({ page }) => {
    await openGlobalList({ page, view: 'List view' });
    const paymentRows = listRows({ page }).filter({ has: page.getByRole('img', { name: 'Paid from 3 accounts' }) });

    await expect(paymentRows).toHaveCount(1);
    await expect(paymentRows).toContainText('-$40.35');
    await expect(listRows({ page }).filter({ hasText: '-$5.25' })).toHaveCount(0);
    await expect(listRows({ page }).filter({ hasText: '-$10.10' })).toHaveCount(0);
  });

  test('global list (table view) shows the payment as one row with the total and an indicator', async ({ page }) => {
    await openGlobalList({ page, view: 'Table view' });
    const paymentRow = page.getByRole('row').filter({ hasText: MAIN });

    await expect(paymentRow).toHaveCount(1);
    await expect(paymentRow).toContainText('-$40.35');
    await expect(paymentRow.getByRole('img', { name: /accounts/ })).toBeVisible();
  });

  test('filtering the global list by one account shows only its own part', async ({ page }) => {
    await openGlobalList({ page, view: 'Table view' });
    await page.getByRole('button', { name: 'All accounts' }).click();
    await page.getByRole('option', { name: new RegExp(`^${SECOND}`) }).click();
    await page.keyboard.press('Escape');

    const rows = page.getByRole('row').filter({ has: page.getByRole('cell') });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(SECOND);
    await expect(rows.first()).toContainText('-$5.25');

    await page.getByRole('button', { name: /^Reset$/ }).click();
  });

  test('opening the payment or one of its parts edits the whole payment', async ({ page }) => {
    await openGlobalList({ page, view: 'List view' });
    await listRows({ page }).filter({ hasText: '-$40.35' }).click();
    let ui = getDialog({ page });
    await expect(ui.accounts.nth(0)).toContainText(MAIN);
    await expect(ui.accounts.nth(1)).toContainText(SECOND);
    await expect(ui.accounts.nth(2)).toContainText(EURO);
    await expect(ui.amounts.nth(0)).toHaveValue('10.1');
    await expect(ui.amounts.nth(1)).toHaveValue('5.25');
    await expect(ui.amounts.nth(2)).toHaveValue('20');
    await expect(ui.share).toHaveValue('25');
    await expect(ui.total).toHaveValue('40.35');
    await page.keyboard.press('Escape');

    await page.goto(`/account/${accountIds[SECOND]}`);
    await page.getByRole('tabpanel', { name: 'Transactions' }).getByText('-$5.25').click();
    ui = getDialog({ page });
    await expect(ui.accounts.nth(0)).toContainText(MAIN);
    await expect(ui.accounts.nth(1)).toContainText(SECOND);
    await expect(ui.total).toHaveValue('40.35');

    await ui.amounts.nth(1).fill('6.25');
    await expect(ui.total).toHaveValue('41.35');
    await ui.saveButton.click();
    await expect(ui.dialog).toBeHidden();

    await expect(sidebarBalance({ page, name: SECOND, balance: '$993.75' })).toBeVisible();
    await expect(sidebarBalance({ page, name: MAIN, balance: '$989.90' })).toBeVisible();
  });

  test('removing a created part deletes it; turning multi-account off merges created parts into the main', async ({
    page,
  }) => {
    await openGlobalList({ page, view: 'List view' });
    await listRows({ page }).filter({ hasText: '-$41.35' }).click();
    let ui = getDialog({ page });

    await ui.removeButtons.nth(1).click();
    await expect(ui.total).toHaveValue('35.10');
    await ui.saveButton.click();
    await expect(ui.dialog).toBeHidden();

    await expect(sidebarBalance({ page, name: SECOND, balance: '$1,000.00' })).toBeVisible();
    await expect(sidebarBalance({ page, name: MAIN, balance: '$989.90' })).toBeVisible();
    await expect(sidebarBalance({ page, name: EURO, balance: '€980.00' })).toBeVisible();

    await openGlobalList({ page, view: 'List view' });
    await listRows({ page }).filter({ hasText: '-$35.10' }).click();
    ui = getDialog({ page });
    await ui.severalAccounts.click();
    await expect(ui.severalAccounts).toHaveAttribute('aria-pressed', 'false');
    await expect(ui.dialog.getByRole('spinbutton', { name: 'Amount USD' })).toHaveValue('35.1');
    await ui.saveButton.click();
    await expect(ui.dialog).toBeHidden();

    await expect(sidebarBalance({ page, name: MAIN, balance: '$964.90' })).toBeVisible();
    await expect(sidebarBalance({ page, name: EURO, balance: '€1,000.00' })).toBeVisible();

    await openGlobalList({ page, view: 'List view' });
    const row = listRows({ page }).filter({ hasText: '-$35.10' });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('img', { name: /Paid from/ })).toHaveCount(0);
  });

  test('links existing transactions as parts; unlinking or turning off restores them', async ({ page }) => {
    const ui = await openNewMultiAccountDialog({ page });
    await ui.amounts.nth(0).fill('3');
    await ui.note.fill('Group dinner');

    await ui.linkExisting.click();
    const picker = page.getByRole('dialog', { name: 'Link existing transactions' });
    await expect(picker.getByText(NEAR_NOTE)).toBeVisible();
    const pickerText = await picker.innerText();
    const at = (text: string) => pickerText.indexOf(text);
    expect(at('Recommended')).toBeGreaterThanOrEqual(0);
    expect(at('Recommended')).toBeLessThan(at(NEAR_NOTE));
    expect(at('Recommended')).toBeLessThan(at(SECOND_NEAR_NOTE));
    expect(at(NEAR_NOTE)).toBeLessThan(at('All transactions'));
    expect(at(SECOND_NEAR_NOTE)).toBeLessThan(at('All transactions'));
    expect(at('All transactions')).toBeLessThan(at(FAR_NOTE));
    expect(pickerText).not.toContain(INCOME_NOTE);

    await linkCandidate({ picker, note: NEAR_NOTE }).click();
    await linkCandidate({ picker, note: SECOND_NEAR_NOTE }).click();
    await picker.getByRole('button', { name: 'Link 2 transactions' }).click();
    await expect(picker).toBeHidden();
    await expect(ui.accounts.nth(1)).toContainText('Select account');
    await ui.removeButtons.nth(1).click();

    await expect(ui.total).toHaveValue('14.75');
    await ui.createButton.click();
    await expect(ui.dialog).toBeHidden();

    await openGlobalList({ page, view: 'List view' });
    const payment = listRows({ page }).filter({ hasText: '-$14.75' });
    await expect(payment).toHaveCount(1);
    await expect(payment.getByRole('img', { name: 'Paid from 3 accounts' })).toBeVisible();
    await expect(listRows({ page }).filter({ hasText: '-$7.50' })).toHaveCount(0);
    await expect(listRows({ page }).filter({ hasText: '-$4.25' })).toHaveCount(0);
    await expect(sidebarBalance({ page, name: THIRD, balance: '$1,002.10' })).toBeVisible();

    await payment.click();
    let edit = getDialog({ page });
    const thirdRowIndex = 1;
    await expect(edit.accounts.nth(thirdRowIndex)).toContainText(THIRD);
    await edit.dialog
      .getByRole('button', { name: /^(Unlink|Remove account)$/ })
      .nth(thirdRowIndex)
      .click();
    await expect(edit.total).toHaveValue('7.25');
    await edit.saveButton.click();
    await expect(edit.dialog).toBeHidden();

    await openGlobalList({ page, view: 'List view' });
    const restoredNear = listRows({ page }).filter({ hasText: NEAR_NOTE });
    await expect(restoredNear).toHaveCount(1);
    await expect(restoredNear).toContainText('-$7.50');
    await expect(sidebarBalance({ page, name: THIRD, balance: '$1,002.10' })).toBeVisible();

    await listRows({ page }).filter({ hasText: '-$7.25' }).click();
    edit = getDialog({ page });
    await edit.severalAccounts.click();
    await edit.saveButton.click();
    await expect(edit.dialog).toBeHidden();

    await openGlobalList({ page, view: 'List view' });
    const restoredSecond = listRows({ page }).filter({ hasText: SECOND_NEAR_NOTE });
    await expect(restoredSecond).toHaveCount(1);
    await expect(restoredSecond).toContainText('-$4.25');
    const main = listRows({ page }).filter({ hasText: 'Group dinner' });
    await expect(main).toHaveCount(1);
    await expect(main).toContainText('-$3.00');
    await expect(sidebarBalance({ page, name: FIFTH, balance: '$995.75' })).toBeVisible();
  });

  test('guard rails: transfer type, allowed accounts and incomplete parts', async ({ page }) => {
    const ui = await openNewMultiAccountDialog({ page });
    await expect(ui.dialog.getByRole('button', { name: 'Select transfer' })).toBeDisabled();

    await ui.accounts.nth(1).click();
    await expect(option({ page, name: SECOND })).toBeVisible();
    await expect(option({ page, name: MAIN })).toHaveCount(0);
    await option({ page, name: SECOND }).click();

    const before = await countTransactions({ api });
    await ui.addAccount.click();
    await ui.amounts.nth(0).fill('2');
    await ui.amounts.nth(1).fill('1');
    await ui.amounts.nth(2).fill('1');
    await expectSaveBlocked({ page, api, before });

    await ui.accounts.nth(2).click();
    await expect(option({ page, name: EURO })).toBeVisible();
    await expect(option({ page, name: MAIN })).toHaveCount(0);
    await option({ page, name: EURO }).click();
    await ui.amounts.nth(2).fill('0');
    await expectSaveBlocked({ page, api, before });

    await ui.amounts.nth(2).fill('1');
    await expect(ui.share).not.toHaveValue('');
    await ui.share.fill('');
    await expectSaveBlocked({ page, api, before });

    await ui.share.fill('1.5');
    await expect(ui.total).toHaveValue('4.50');
    await ui.createButton.click();
    await expect(ui.dialog).toBeHidden();
    expect(await countTransactions({ api })).toBeGreaterThan(before);
  });

  test('guard rail: an account already used by a part cannot be used again', async ({ page }) => {
    const ui = await openNewMultiAccountDialog({ page });
    await ui.amounts.nth(0).fill('2');
    await pickPartAccount({ page, nth: 1, name: SECOND });
    await ui.amounts.nth(1).fill('1');
    await ui.addAccount.click();
    await ui.amounts.nth(2).fill('1');

    const before = await countTransactions({ api });
    await ui.accounts.nth(2).click();
    if ((await option({ page, name: SECOND }).count()) === 0) return;
    await option({ page, name: SECOND }).click();
    await expectSaveBlocked({ page, api, before });
  });

  test('guard rail: no more than 4 parts can be added next to the main account', async ({ page }) => {
    const ui = await openNewMultiAccountDialog({ page });
    const parts = [SECOND, THIRD, FOURTH, FIFTH];

    for (const [index, name] of parts.entries()) {
      if (index > 0) await ui.addAccount.click();
      await pickPartAccount({ page, nth: index + 1, name });
    }

    await expect(ui.accounts.nth(parts.length)).toContainText(FIFTH);
    const rowsAtLimit = await ui.accounts.count();
    await ui.addAccount.click({ timeout: 3_000 }).catch(() => {});
    await expect(ui.accounts).toHaveCount(rowsAtLimit);
  });

  test('guard rail: linking existing transactions cannot go past 5 accounts', async ({ page }) => {
    const ui = await openNewMultiAccountDialog({ page });
    const parts = [SECOND, FOURTH, SIXTH];
    for (const [index, name] of parts.entries()) {
      if (index > 0) await ui.addAccount.click();
      await pickPartAccount({ page, nth: index + 1, name });
    }

    await ui.linkExisting.click();
    const picker = page.getByRole('dialog', { name: 'Link existing transactions' });
    await expect(picker.getByText(NEAR_NOTE)).toBeVisible();
    await linkCandidate({ picker, note: NEAR_NOTE }).click();
    await picker.getByText(SECOND_NEAR_NOTE).first().click();
    await expect(picker.getByRole('button', { name: 'Link 2 transactions' })).toHaveCount(0);
    await picker.getByRole('button', { name: 'Link 1 transaction' }).click();
    await expect(picker).toBeHidden();

    await expect(ui.accounts.nth(parts.length + 1)).toContainText(THIRD);
    await expect(ui.addAccount).toHaveCount(0);
    await expect(ui.linkExisting).toHaveCount(0);
  });
});
