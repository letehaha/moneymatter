import { type Page, expect, test } from '@playwright/test';

import { completeOnboarding, createAccount, extractId, signInViaApi } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { type ChatStub, buildCard, buildMessage, stubChatApi } from '../../helpers/chat-stubs';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const creds = buildTestCredentials({ prefix: 'chat-cards' });

const THREAD_ID = 'thread-1';
const MOBILE_VIEWPORT = { width: 390, height: 844 };
/** Where the folding specs save screenshots of the cards for a review by eye; unset, they save none. */
const SCREENSHOT_DIR = process.env.CHAT_CARD_SCREENSHOT_DIR;

let accountId: string;

const tagField = ({ name }: { name: string }) => ({
  path: 'name',
  labelKey: 'chat.fields.name',
  value: name,
  editable: null,
});

const assistantWithCards = ({ ids }: { ids: string[] }) =>
  buildMessage({
    id: 'assistant-seed',
    role: 'assistant',
    threadId: THREAD_ID,
    parts: ids.map((id) => ({ type: 'proposal', id: `part-${id}`, proposalId: id })),
  });

const cardLocator = ({ page, name }: { page: Page; name: string }) =>
  page.getByTestId('proposal-card').filter({ hasText: name });

test.describe('Chat cards', () => {
  test.beforeAll(async ({ playwright }) => {
    await signUpAndVerify({ creds });
    const request = await signInViaApi({ playwright, email: creds.email, password: creds.password });
    await completeOnboarding({ request, currencyCode: 'USD' });
    accountId = extractId(
      await createAccount({ request, name: 'Main card', currencyCode: 'USD', initialBalance: 100 }),
    );
  });

  let stub: ChatStub;

  test.beforeEach(async ({ page }) => {
    stub = await stubChatApi({ page });
    await loginViaUI({ page, email: creds.email, password: creds.password });
  });

  const open = async ({ page, cards }: { page: Page; cards: Array<Record<string, unknown> & { id: string }> }) => {
    for (const card of cards) stub.addCard(card);
    stub.addThread({
      id: THREAD_ID,
      title: 'Tags',
      messages: [assistantWithCards({ ids: cards.map((card) => card.id) })],
    });
    await page.goto(`/chat/${THREAD_ID}`);
  };

  test('approves a card and shows it as applied', async ({ page }) => {
    await open({ page, cards: [buildCard({ id: 'c1', fields: [tagField({ name: 'Coffee' })] })] });

    const card = cardLocator({ page, name: 'Coffee' });
    await expect(card).toContainText('Waiting for you');

    await card.getByTestId('approve').click();

    await expect(card).toContainText('Applied');
    await expect(card.getByTestId('approve')).toHaveCount(0);
    const approve = stub.calls.find((call) => call.path === '/proposals/c1/approve');
    expect(approve?.body).toMatchObject({ revision: 1 });
  });

  test('"Approve all safe" applies the safe cards and leaves a red and an amber card pending', async ({ page }) => {
    await open({
      page,
      cards: [
        buildCard({ id: 'safe-1', fields: [tagField({ name: 'Coffee' })] }),
        buildCard({ id: 'safe-2', fields: [tagField({ name: 'Lunch' })] }),
        buildCard({
          id: 'red',
          kind: 'delete',
          danger: 'destructive',
          confirmation: { mode: 'confirm' },
          safe: false,
          title: { key: 'chat.cards.title.delete', params: { entity: 'tag' } },
          fields: [tagField({ name: 'Old tag' })],
        }),
        buildCard({
          id: 'amber',
          toolName: 'update_user_currency',
          kind: 'update',
          entity: 'userCurrency',
          safe: false,
          confirmation: { mode: 'confirm' },
          egress: { url: 'https://rates.example.com/api', host: 'rates.example.com' },
          title: { key: 'chat.cards.title.update', params: { entity: 'userCurrency' } },
          fields: [tagField({ name: 'Rate feed' })],
        }),
      ],
    });

    await page.getByTestId('approve-all').click();

    await expect(cardLocator({ page, name: 'Coffee' })).toContainText('Applied');
    await expect(cardLocator({ page, name: 'Lunch' })).toContainText('Applied');
    await expect(cardLocator({ page, name: 'Old tag' })).toContainText('Waiting for you');
    await expect(cardLocator({ page, name: 'Rate feed' })).toContainText('Waiting for you');
    // Only safe cards are left to approve: the bar is gone with none left.
    await expect(page.getByTestId('approve-all')).toHaveCount(0);
    // The amber card shows where the server would send requests.
    await expect(cardLocator({ page, name: 'Rate feed' })).toContainText('rates.example.com');
  });

  test('rejects a card, then asks for a change on another', async ({ page }) => {
    await open({
      page,
      cards: [
        buildCard({ id: 'a', fields: [tagField({ name: 'Coffee' })] }),
        buildCard({ id: 'b', fields: [tagField({ name: 'Lunch' })] }),
      ],
    });

    await cardLocator({ page, name: 'Coffee' }).getByTestId('reject').click();
    await expect(cardLocator({ page, name: 'Coffee' })).toContainText('Rejected');

    const lunch = cardLocator({ page, name: 'Lunch' });
    await lunch.getByTestId('comment-toggle').click();
    await lunch.getByTestId('comment-input').locator('textarea').fill('Call it Lunch out');
    await lunch.getByTestId('comment-send').click();

    await expect
      .poll(() => stub.calls.find((call) => call.path === '/proposals/b/comment')?.body)
      .toEqual({
        text: 'Call it Lunch out',
      });
  });

  test('a bulk red card asks for the affected count before it can be approved', async ({ page }) => {
    await open({
      page,
      cards: [
        buildCard({
          id: 'bulk',
          toolName: 'bulk_delete_transactions',
          kind: 'bulk',
          entity: 'transaction',
          danger: 'destructive',
          confirmation: { mode: 'typed', phrase: '42' },
          safe: false,
          title: { key: 'chat.cards.title.bulk', params: { entity: 'transaction' } },
          fields: [tagField({ name: 'March coffee' })],
          affected: {
            count: 42,
            truncated: true,
            columns: [{ key: 'note', label: 'chat.cards.columns.note', kind: 'text' }],
            rows: [{ note: 'Espresso' }, { note: 'Flat white' }],
          },
        }),
      ],
    });

    const card = cardLocator({ page, name: 'March coffee' });
    await expect(card).toContainText('42 records affected');
    await expect(card.getByTestId('approve')).toBeDisabled();

    await card.getByTestId('typed-confirmation').getByRole('textbox').fill('41');
    await expect(card.getByTestId('approve')).toBeDisabled();

    await card.getByTestId('typed-confirmation').getByRole('textbox').fill('42');
    await expect(card.getByTestId('approve')).toBeEnabled();
    await card.getByTestId('approve').click();

    await expect(card).toContainText('Applied');
    const approve = stub.calls.find((call) => call.path === '/proposals/bulk/approve');
    expect(approve?.body).toMatchObject({ confirmation: '42' });
  });
  test('shows which record a delete card removes, at the width of a narrow panel', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await open({
      page,
      cards: [
        buildCard({
          id: 'c-del',
          kind: 'delete',
          toolName: 'delete_transaction',
          fields: [
            { path: 'id', labelKey: 'chat.fields.id', value: 'tx-1', display: { kind: 'text' }, editable: null },
          ],
          target: [
            {
              path: 'amount',
              labelKey: 'chat.fields.amount',
              value: 28.1,
              display: { kind: 'money', currencyCode: 'GEL' },
              editable: null,
            },
            {
              path: 'time',
              labelKey: 'chat.fields.time',
              value: '2026-10-19T07:26:00Z',
              display: { kind: 'datetime' },
              editable: null,
            },
            {
              path: 'note',
              labelKey: 'chat.fields.note',
              value: 'Nord Coffee',
              display: { kind: 'text' },
              editable: null,
            },
            {
              path: 'transactionType',
              labelKey: 'chat.fields.transactionType',
              value: 'expense',
              display: { kind: 'enum' },
              editable: null,
            },
          ],
        }),
      ],
    });

    const target = page.getByTestId('card-target');
    await expect(target).toContainText('Nord Coffee');
    await expect(target).toContainText('GEL');
    await expect(target).toContainText('Oct 19, 2026');
    await expect(target).toContainText('Expense');
    await expect(target).not.toContainText('2026-10-19T');
    const box = await target.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  });
  test('edits a card with real labels: a date and time picker, named choices and the currency of the amount', async ({
    page,
  }) => {
    const field = ({ path, value, display, editable }: Record<string, unknown>) => ({
      path,
      labelKey: `chat.fields.${path}`,
      value,
      display,
      editable,
    });
    await open({
      page,
      cards: [
        buildCard({
          id: 'c-edit',
          fields: [
            field({ path: 'amount', value: 12, display: { kind: 'money' }, editable: { type: 'money' } }),
            field({
              path: 'time',
              value: '2026-10-19T07:26:00Z',
              display: { kind: 'datetime' },
              editable: { type: 'datetime' },
            }),
            field({
              path: 'paymentType',
              value: 'debitCard',
              display: { kind: 'enum' },
              editable: { type: 'enum', options: ['cash', 'debitCard', 'creditCard'] },
            }),
            field({
              path: 'transferNature',
              value: 'not_transfer',
              display: { kind: 'enum' },
              editable: { type: 'enum', options: ['not_transfer', 'transfer_between_user_accounts'] },
            }),
            field({
              path: 'transactionType',
              value: 'expense',
              display: { kind: 'enum' },
              editable: { type: 'enum', options: ['income', 'expense'] },
            }),
          ],
        }),
      ],
    });

    await page.getByTestId('edit').click();

    await expect(page.getByTestId('field-editor-amount')).toContainText('Amount (USD)');
    const when = page.getByTestId('field-editor-time').locator('input[type="datetime-local"]');
    await expect(when).toHaveCount(1);
    await expect(when).not.toHaveValue('');

    const payment = page.getByTestId('field-editor-paymentType');
    await expect(payment).toContainText('Debit card');
    await expect(payment).not.toContainText('debitCard');
    await expect(page.getByTestId('field-editor-transferNature')).toContainText('Not a transfer');
    await expect(page.getByTestId('field-editor-transactionType')).toContainText('Expense');

    await payment.getByRole('combobox').click();
    await expect(page.getByRole('option', { name: 'Credit card' })).toBeAttached();
    await expect(page.getByRole('option', { name: 'creditCard' })).toHaveCount(0);
  });

  test.describe('folding', () => {
    const text = ({ path, value }: { path: string; value: string }) => ({
      path,
      labelKey: `chat.fields.${path}`,
      value,
      display: { kind: 'text' },
      editable: null,
    });

    /** An update of a transaction: the card names the record by its date, amount, note and account. */
    const transactionCard = ({ id, note, ...overrides }: Record<string, unknown> & { id: string; note: string }) =>
      buildCard({
        id,
        kind: 'update',
        toolName: 'update_transaction',
        entity: 'transaction',
        title: { key: 'chat.cards.title.update', params: { entity: 'transaction' } },
        fields: [text({ path: 'description', value: `${note} (fixed)` })],
        target: [
          {
            path: 'amount',
            labelKey: 'chat.fields.amount',
            value: 28.1,
            display: { kind: 'money', currencyCode: 'GEL' },
            editable: null,
          },
          {
            path: 'time',
            labelKey: 'chat.fields.time',
            value: '2026-10-19T07:26:00Z',
            display: { kind: 'datetime' },
            editable: null,
          },
          text({ path: 'note', value: note }),
          {
            path: 'accountId',
            labelKey: 'chat.fields.accountId',
            value: accountId,
            display: { kind: 'entity', entity: { kind: 'account', id: accountId, label: '' } },
            editable: null,
          },
        ],
        ...overrides,
      });

    const openAllStatuses = ({ page }: { page: Page }) =>
      open({
        page,
        cards: [
          transactionCard({ id: 'applied', note: 'Nord Coffee', status: 'applied' }),
          transactionCard({ id: 'rejected', note: 'Bakery', status: 'rejected', statusReason: 'rejectedByUser' }),
          transactionCard({ id: 'failed', note: 'Taxi', status: 'failed', error: { message: 'Account is archived' } }),
          transactionCard({ id: 'pending', note: 'Cinema' }),
          transactionCard({
            id: 'stale',
            note: 'Books',
            status: 'stale',
            canApply: { ok: false, reasonKey: 'chat.cards.stale' },
            stale: { reasonKey: 'chat.cards.stale' },
          }),
        ],
      });

    const card = ({ page, note }: { page: Page; note: string }) => cardLocator({ page, name: note });

    /** Saves the whole list of cards, past the scroll of the conversation, once the account is named. */
    const saveCards = async ({ page, name }: { page: Page; name: string }) => {
      if (!SCREENSHOT_DIR) return;
      await expect(card({ page, note: 'Nord Coffee' })).toContainText('Main card');
      await page
        .getByTestId('proposal-card')
        .first()
        .locator('..')
        .screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
    };

    test('a finished card shows its header and a summary, and opens from the header', async ({ page }) => {
      await openAllStatuses({ page });

      const applied = card({ page, note: 'Nord Coffee' });
      const toggle = applied.getByTestId('card-fold-toggle');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(applied.getByTestId('card-body')).toHaveCount(0);
      // Folded, the header keeps the title and the status badge; only the body goes.
      await expect(applied.getByText('Update transaction')).toBeVisible();
      await expect(applied.getByTestId('card-status')).toBeVisible();
      await expect(applied.getByTestId('card-status')).toHaveText('Applied');
      await expect(applied.getByTestId('card-summary')).toHaveText(
        /^Oct 19, 2026, [^·]+ · [^·]*28\.10[^·]* · Nord Coffee · Main card$/,
      );

      await toggle.click();

      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(applied.getByTestId('card-body')).toBeVisible();
      await expect(applied.getByTestId('card-body')).toContainText('Nord Coffee');
      await expect(applied.getByTestId('card-summary')).toHaveCount(0);

      // A button: the keyboard folds it again.
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(applied.getByTestId('card-body')).toHaveCount(0);

      // A settled card starts folded, its badge still in the header.
      const rejected = card({ page, note: 'Bakery' });
      await expect(rejected.getByTestId('card-fold-toggle')).toHaveAttribute('aria-expanded', 'false');
      await expect(rejected.getByTestId('card-status')).toBeVisible();
      await expect(rejected.getByTestId('card-status')).toHaveText('Rejected');

      // A card that waits for the owner, needs a refresh, or failed but can still be refreshed, edited or
      // rejected stays open with its actions in view.
      for (const note of ['Cinema', 'Books', 'Taxi']) {
        await expect(card({ page, note }).getByTestId('card-fold-toggle')).toHaveAttribute('aria-expanded', 'true');
        await expect(card({ page, note }).getByTestId('card-body')).toBeVisible();
      }
      const failed = card({ page, note: 'Taxi' });
      await expect(failed.getByTestId('card-status')).toHaveText('Failed');
      await expect(failed.getByTestId('card-error')).toHaveText('Account is archived');
      await expect(failed.getByTestId('refresh')).toBeVisible();
      await expect(failed.getByTestId('reject')).toBeVisible();
    });

    test('colours each status badge by what it means', async ({ page }) => {
      await openAllStatuses({ page });

      const badge = (note: string) => card({ page, note }).getByTestId('card-status');
      await expect(badge('Nord Coffee')).toHaveText('Applied');
      await expect(badge('Nord Coffee')).toHaveAttribute('data-variant', 'success');
      await expect(badge('Bakery')).toHaveText('Rejected');
      await expect(badge('Bakery')).toHaveAttribute('data-variant', 'destructive');
      await expect(badge('Taxi')).toHaveText('Failed');
      await expect(badge('Taxi')).toHaveAttribute('data-variant', 'destructive');
      await expect(badge('Cinema')).toHaveText('Waiting for you');
      await expect(badge('Cinema')).toHaveAttribute('data-variant', 'info');
      await expect(badge('Books')).toHaveText('Out of date');
      await expect(badge('Books')).toHaveAttribute('data-variant', 'warning');

      // The colours the user sees: rejected reads as red as failed does, and neither as the accent.
      const colorOf = (note: string) => badge(note).evaluate((element) => getComputedStyle(element).color);
      const [rejected, failed, waiting] = await Promise.all(['Bakery', 'Taxi', 'Cinema'].map((note) => colorOf(note)));
      expect(rejected).toBe(failed);
      expect(rejected).not.toBe(waiting);

      await saveCards({ page, name: 'chat-cards-desktop' });
    });

    test.describe('on a phone', () => {
      test.use({ viewport: MOBILE_VIEWPORT });

      test('folded cards fit the screen and open from the header', async ({ page }) => {
        await openAllStatuses({ page });

        const applied = card({ page, note: 'Nord Coffee' });
        const summary = applied.getByTestId('card-summary');
        await expect(summary).toBeVisible();
        // One line, cut short when it does not fit.
        const box = (await summary.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
        const lineHeight = await summary.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
        expect(box.height).toBeLessThan(lineHeight * 1.5);
        await saveCards({ page, name: 'chat-cards-phone' });

        await applied.getByTestId('card-fold-toggle').click();
        await expect(applied.getByTestId('card-body')).toBeVisible();
        await saveCards({ page, name: 'chat-cards-phone-expanded' });
      });
    });
  });
});
