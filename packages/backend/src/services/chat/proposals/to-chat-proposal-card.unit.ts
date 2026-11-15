import { describe, expect, it, jest } from '@jest/globals';

// The import chains of the services behind the catalog's tools open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));

import { toChatProposalCard } from './to-chat-proposal-card';

const ID = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    id: '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20',
    status: 'pending',
    statusReason: null,
    revision: 1,
    toolName: 'update_account',
    cardKind: 'update',
    entity: 'account',
    danger: 'none',
    confirmation: 'none',
    confirmationPhrase: null,
    args: { accountId: ID, name: 'Wallet', excludeFromStats: false },
    editedFields: [],
    preview: { before: { id: ID, name: 'Cash', excludeFromStats: false, currentBalance: 10 } },
    uncertainFields: null,
    sources: [],
    dependsOn: [],
    executedArgs: null,
    result: null,
    error: null,
    createdAt: new Date('2026-10-18T09:00:00.000Z'),
    expiresAt: new Date('2026-10-19T09:00:00.000Z'),
    appliedAt: null,
    ...overrides,
  }) as never;

const createTransactionRow = (overrides: Record<string, unknown> = {}) =>
  row({
    toolName: 'create_transaction',
    cardKind: 'create',
    entity: 'transaction',
    args: {
      accountId: ID,
      payeeId: ID,
      categoryId: ID,
      amount: 12,
      time: '2026-10-19T07:26:00Z',
      transactionType: 'expense',
      transferNature: 'not_transfer',
      paymentType: 'cash',
      note: 'Nord Coffee',
    },
    preview: null,
    ...overrides,
  });

describe('toChatProposalCard', () => {
  describe('the currency of an amount the arguments do not state', () => {
    const fieldOf = ({ overrides, path }: { overrides: Record<string, unknown>; path: string }) =>
      toChatProposalCard({ row: row(overrides), parents: [] }).fields.find((field) => field.path === path);

    it('shows the balance of a loan in the currency of its account', () => {
      const field = fieldOf({
        path: 'currentBalance',
        overrides: {
          toolName: 'update_loan',
          entity: 'loan',
          args: { loanId: ID, currentBalance: 900 },
          preview: { before: { accountId: ID, moneyCurrencies: { currentBalance: 'EUR' } } },
        },
      });

      expect(field?.display).toEqual({ kind: 'money', currencyCode: 'EUR' });
    });

    it.each([
      ['pay_subscription_period', 'action', 'amount', { subscriptionId: ID, periodId: ID, amount: 9 }],
      ['update_transaction_template', 'update', 'amount', { templateId: ID, amount: 9 }],
      ['update_transaction', 'update', 'destinationAmount', { id: ID, destinationAmount: 9 }],
      ['create_transaction', 'create', 'destinationAmount', { destinationTransactionId: ID, destinationAmount: 9 }],
      ['update_tracker', 'update', 'limitAmount', { trackerId: ID, limitAmount: 9 }],
      ['update_tracker_line', 'update', 'limitAmount', { trackerId: ID, lineId: ID, limitAmount: 9 }],
      ['create_tracker_line', 'create', 'limitAmount', { trackerId: ID, name: 'Food', limitAmount: 9 }],
    ])('shows %s in the stored currency', (toolName, cardKind, path, args) => {
      const field = fieldOf({
        path,
        overrides: { toolName, cardKind, args, preview: { before: { moneyCurrencies: { [path]: 'JPY' } } } },
      });

      expect(field?.display).toEqual({ kind: 'money', currencyCode: 'JPY' });
    });

    it.each([
      ['an account the amount moves to', 'update_transaction_template', 'amount', { templateId: ID, accountId: ID }],
      ['an account the payment books on', 'pay_subscription_period', 'amount', { subscriptionId: ID, accountId: ID }],
      ['a destination account', 'update_transaction', 'destinationAmount', { id: ID, destinationAccountId: ID }],
    ])('leaves the amount to %s', (_name, toolName, path, args) => {
      const field = fieldOf({
        path,
        overrides: {
          toolName,
          args: { ...args, [path]: 9 },
          preview: { before: { moneyCurrencies: { [path]: 'JPY' } } },
        },
      });

      expect(field?.display).toEqual({ kind: 'money' });
    });

    it('keeps the stored currency when the account argument is cleared', () => {
      const field = fieldOf({
        path: 'amount',
        overrides: {
          toolName: 'update_transaction_template',
          args: { templateId: ID, amount: 9, accountId: null },
          preview: { before: { moneyCurrencies: { amount: 'JPY' } } },
        },
      });

      expect(field?.display).toEqual({ kind: 'money', currencyCode: 'JPY' });
    });

    it('reads the bookkeeping that carries the currency as no value of the card', () => {
      const card = toChatProposalCard({
        row: row({
          toolName: 'update_transaction_template',
          args: { templateId: ID, amount: 9 },
          preview: { before: { amount: 5, moneyCurrencies: { amount: 'JPY' } } },
        }),
        parents: [],
      });

      expect(card.target?.find((field) => field.path === 'amount')?.display).toEqual({
        kind: 'money',
        currencyCode: 'JPY',
      });
      expect(card.target?.some((field) => field.path === 'moneyCurrencies')).toBe(false);
      expect(card.fields.some((field) => field.path === 'moneyCurrencies')).toBe(false);
    });
  });

  it('offers only the alternatives that could replace the value of the field', () => {
    const card = toChatProposalCard({
      row: row({
        toolName: 'update_subscription',
        entity: 'subscription',
        args: { id: ID, expectedAmount: 2.59, note: 'Gas' },
        preview: null,
        uncertainFields: [
          {
            field: 'expectedAmount',
            reason: 'guessedFromAttachment',
            alternatives: [3.1, 'The real amount may differ from this estimate'],
          },
          { field: 'note', reason: 'other', alternatives: ['Gas bill'] },
        ],
      }),
      parents: [],
    });

    const uncertainOf = ({ path }: { path: string }) => card.fields.find((field) => field.path === path)?.uncertain;

    expect(uncertainOf({ path: 'expectedAmount' })).toEqual({ reason: 'guessedFromAttachment', alternatives: [3.1] });
    expect(uncertainOf({ path: 'note' })).toEqual({ reason: 'other', alternatives: ['Gas bill'] });
  });

  it('names the record a delete or update card targets from its preview, and no record for a create card', () => {
    const before = { id: ID, amount: 28.1, currencyCode: 'GEL', note: 'Nord Coffee', time: '2026-10-19T07:26:00.000Z' };
    const base = { toolName: 'delete_transaction', cardKind: 'delete', entity: 'transaction', args: { id: ID } };

    const del = toChatProposalCard({ row: row({ ...base, preview: { before } }), parents: [] });
    const update = toChatProposalCard({ row: row({ ...base, cardKind: 'update', preview: { before } }), parents: [] });
    const create = toChatProposalCard({ row: createTransactionRow({ preview: { before } }), parents: [] });
    const unresolved = toChatProposalCard({ row: row({ ...base, preview: null }), parents: [] });

    expect(del.target?.map((field) => field.path)).toEqual(['amount', 'time', 'note']);
    expect(update.target?.map((field) => field.path)).toEqual(['amount', 'time', 'note']);
    expect(create).not.toHaveProperty('target');
    expect(unresolved).not.toHaveProperty('target');
  });

  it('shows the ids of a transaction as records, its time as a date and time and its enums as choices', () => {
    const card = toChatProposalCard({ row: createTransactionRow(), parents: [] });
    const display = (path: string) => card.fields.find((field) => field.path === path)?.display?.kind;

    expect(['accountId', 'payeeId', 'categoryId'].map(display)).toEqual(['entity', 'entity', 'entity']);
    expect(display('time')).toBe('datetime');
    expect(['transactionType', 'transferNature', 'paymentType'].map(display)).toEqual(['enum', 'enum', 'enum']);
    expect(display('amount')).toBe('money');
  });

  it('shows the value before on each field the call changes', () => {
    const card = toChatProposalCard({ row: row(), parents: [] });

    expect(card.fields.find((field) => field.path === 'name')).toMatchObject({ value: 'Wallet', before: 'Cash' });
  });

  it('marks the argument that names the target record, and no other', () => {
    const card = toChatProposalCard({ row: row(), parents: [] });

    expect(card.fields.find((field) => field.path === 'accountId')?.namesRecord).toBe(true);
    expect(card.fields.find((field) => field.path === 'name')).not.toHaveProperty('namesRecord');
  });

  it('sends the related counts that are not zero', () => {
    const card = toChatProposalCard({
      row: row({ preview: { before: null, counts: { splitCount: 2, transferTwinCount: 1, refundLinkCount: 0 } } }),
      parents: [],
    });

    expect(card.counts).toEqual({ splitCount: 2, transferTwinCount: 1 });
  });

  it('sends no counts when the preview holds none, or only zeros', () => {
    expect(toChatProposalCard({ row: row(), parents: [] })).not.toHaveProperty('counts');
    expect(
      toChatProposalCard({ row: row({ preview: { before: null, counts: { splitCount: 0 } } }), parents: [] }),
    ).not.toHaveProperty('counts');
  });

  it('leaves out the value before on a field the call leaves as it is, and on one the row does not hold', () => {
    const card = toChatProposalCard({ row: row(), parents: [] });

    expect(card.fields.find((field) => field.path === 'excludeFromStats')).not.toHaveProperty('before');
    expect(card.fields.find((field) => field.path === 'accountId')).not.toHaveProperty('before');
  });

  it('shows no value before when the preview holds no row', () => {
    const card = toChatProposalCard({ row: row({ preview: { before: null } }), parents: [] });

    expect(card.fields.every((field) => !('before' in field))).toBe(true);
  });

  it('compares objects by value, so an unchanged nested argument shows no value before', () => {
    const card = toChatProposalCard({
      row: row({
        toolName: 'update_transaction_automation',
        entity: 'transactionAutomation',
        args: { id: ID, conditions: { match: 'all', items: [] } },
        preview: { before: { id: ID, conditions: { match: 'all', items: [] } } },
      }),
      parents: [],
    });

    expect(card.fields.find((field) => field.path === 'conditions')).not.toHaveProperty('before');
  });
});
