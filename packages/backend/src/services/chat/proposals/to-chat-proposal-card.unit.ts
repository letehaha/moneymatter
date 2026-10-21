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
