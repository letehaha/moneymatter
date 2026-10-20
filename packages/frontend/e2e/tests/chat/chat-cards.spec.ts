import { type Page, expect, test } from '@playwright/test';

import { completeOnboarding, signInViaApi } from '../../helpers/api-client';
import { loginViaUI } from '../../helpers/auth';
import { type ChatStub, buildCard, buildMessage, stubChatApi } from '../../helpers/chat-stubs';
import { buildTestCredentials, signUpAndVerify } from '../../helpers/test-setup';

const creds = buildTestCredentials({ prefix: 'chat-cards' });

const THREAD_ID = 'thread-1';

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
          toolName: 'set_currency_rate_source',
          kind: 'settings',
          entity: 'userCurrency',
          safe: false,
          confirmation: { mode: 'confirm' },
          egress: { url: 'https://rates.example.com/api', host: 'rates.example.com' },
          title: { key: 'chat.cards.title.settings', params: { entity: 'userCurrency' } },
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
});
