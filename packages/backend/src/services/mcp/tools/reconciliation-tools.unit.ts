import {
  RECONCILIATION_MERGE_MAX,
  RECONCILIATION_MERGE_MIN,
  RECONCILIATION_REMOVE_MAX,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import {
  reconciliationIdsBodySchema,
  reconciliationMergeBodySchema,
} from '@controllers/transactions.controller/reconciliation-schemas';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError, ValidationError } from '@js/errors';
import { getPayeeNames } from '@services/payees/get-payee-names';
import { getReconciliationHistory } from '@services/transactions/reconciliation/get-history';
import { mergeTransactions } from '@services/transactions/reconciliation/merge-transactions';
import { removeTransactions } from '@services/transactions/reconciliation/remove-transactions';
import { restoreTransactions } from '@services/transactions/reconciliation/restore-transactions';
import { getStuckPending, keepAsBooked } from '@services/transactions/reconciliation/stuck-pending';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test. The services return API-shaped transactions already.
jest.mock('@services/transactions/reconciliation/get-history', () => ({ getReconciliationHistory: jest.fn() }));
jest.mock('@services/transactions/reconciliation/merge-transactions', () => ({ mergeTransactions: jest.fn() }));
jest.mock('@services/transactions/reconciliation/remove-transactions', () => ({ removeTransactions: jest.fn() }));
jest.mock('@services/transactions/reconciliation/restore-transactions', () => ({ restoreTransactions: jest.fn() }));
jest.mock('@services/transactions/reconciliation/stuck-pending', () => ({
  getStuckPending: jest.fn(),
  keepAsBooked: jest.fn(),
}));
jest.mock('@services/payees/get-payee-names', () => ({ getPayeeNames: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerGetReconciliationHistory } from './get-reconciliation-history';
import { registerKeepPendingAsBooked } from './keep-pending-as-booked';
import { registerListStuckPendingTransactions } from './list-stuck-pending-transactions';
import { registerMergeDuplicateTransactions } from './merge-duplicate-transactions';
import { registerRemoveDuplicateTransactions } from './remove-duplicate-transactions';
import { registerRestoreRemovedTransactions } from './restore-removed-transactions';

const READ = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const payeeNames = jest.mocked(getPayeeNames);
const history = jest.mocked(getReconciliationHistory);
const stuckPending = jest.mocked(getStuckPending);
const merge = jest.mocked(mergeTransactions);
const remove = jest.mocked(removeTransactions);
const restore = jest.mocked(restoreTransactions);
const keepBooked = jest.mocked(keepAsBooked);

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';
const ID_4 = '44444444-4444-4444-8444-444444444444';
const ID_5 = '55555555-5555-4555-8555-555555555555';
const ACCOUNT_ID = '66666666-6666-4666-8666-666666666666';
const PAYEE_ID = '77777777-7777-4777-8777-777777777777';

/** An API-shaped transaction, as the REST serializer would hand it to the slimmer. */
const makeTx = (patch: Record<string, unknown> = {}) => ({
  id: ID_1,
  userId: 42,
  time: '2026-10-01T10:00:00.000Z',
  amount: 12.5,
  refAmount: 12.5,
  currencyCode: 'USD',
  note: 'coffee',
  transactionType: TRANSACTION_TYPES.expense,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  transferId: null,
  accountId: ACCOUNT_ID,
  categoryId: null,
  isPlanned: false,
  payeeId: null,
  ...patch,
});

const call = async ({
  tool,
  args,
  extra = READ,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
  payeeNames.mockResolvedValue(new Map());
});

describe('get_reconciliation_history', () => {
  const tool = captureTools({ register: registerGetReconciliationHistory })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  const makeEvents = () => [
    {
      type: 'merge' as const,
      removedAt: '2026-10-03T00:00:00.000Z',
      transactions: [makeTx({ id: ID_2, payeeId: PAYEE_ID })],
      survivor: makeTx({ id: ID_1, payeeId: PAYEE_ID }),
    },
    {
      type: 'remove' as const,
      removedAt: '2026-10-02T00:00:00.000Z',
      transactions: [makeTx({ id: ID_3 }), makeTx({ id: ID_4 })],
      survivor: null,
    },
    {
      type: 'remove' as const,
      removedAt: '2026-10-01T00:00:00.000Z',
      transactions: [makeTx({ id: ID_5 })],
      survivor: null,
    },
  ];

  it('registers under its name and describes restoring', () => {
    expect(tool.name).toBe('get_reconciliation_history');
    expect(tool.config.description).toMatch(/restore_removed_transactions/);
  });

  it('accepts no argument or a limit from 1 to 200 and refuses the rest', () => {
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ limit: 200 }).success).toBe(true);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 201 }).success).toBe(false);
    expect(schema.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  it('returns each removal or merge with slim transactions, their payee and the survivor', async () => {
    history.mockResolvedValue(makeEvents() as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Starbucks']]));

    const data = (await call({ tool, args: {} })) as {
      events: {
        type: string;
        removedAt: string;
        transactions: Record<string, unknown>[];
        survivor: Record<string, unknown> | null;
      }[];
      total: number;
    };

    expect(history).toHaveBeenCalledWith({ userId: 42 });
    expect(payeeNames).toHaveBeenCalledTimes(1);
    expect(data.total).toBe(3);
    expect(data.events.map((event) => event.type)).toEqual(['merge', 'remove', 'remove']);
    expect(data.events[0]).toMatchObject({
      removedAt: '2026-10-03T00:00:00.000Z',
      transactions: [{ id: ID_2, payee: { id: PAYEE_ID, name: 'Starbucks' } }],
      survivor: { id: ID_1, payee: { id: PAYEE_ID, name: 'Starbucks' } },
    });
    expect(data.events[1]!.survivor).toBeNull();
    expect(data.events[1]!.transactions.map((tx) => tx.id)).toEqual([ID_3, ID_4]);
    expect(data.events[0]!.transactions[0]).not.toHaveProperty('userId');
  });

  it('keeps the newest events up to the limit and reports the full count', async () => {
    history.mockResolvedValue(makeEvents() as never);

    const data = (await call({ tool, args: { limit: 2 } })) as { events: { removedAt: string }[]; total: number };

    expect(data.total).toBe(3);
    expect(data.events.map((event) => event.removedAt)).toEqual([
      '2026-10-03T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z',
    ]);
  });

  it('returns an empty list when nothing was ever removed', async () => {
    history.mockResolvedValue([]);

    expect(await call({ tool, args: {} })).toEqual({ events: [], total: 0 });
  });

  it('is a read tool: a read-only user may call it and no lock is checked', async () => {
    history.mockResolvedValue([]);
    lockCheck.mockResolvedValue(true);

    await call({ tool, args: {}, extra: READ });

    expect(lockCheck).not.toHaveBeenCalled();
    expect(history).toHaveBeenCalled();
  });
});

describe('list_stuck_pending_transactions', () => {
  const tool = captureTools({ register: registerListStuckPendingTransactions })[0]!;

  it('registers under its name and takes no input', () => {
    expect(tool.name).toBe('list_stuck_pending_transactions');
    expect(tool.config.inputSchema).toBeUndefined();
  });

  it('returns each pending transaction with its likely booked twin, both slim with their payee', async () => {
    stuckPending.mockResolvedValue([
      {
        transaction: makeTx({ id: ID_1, payeeId: PAYEE_ID }),
        candidate: makeTx({ id: ID_2 }),
        canCheckWithBank: true,
        pendingDays: 9,
      },
      { transaction: makeTx({ id: ID_3 }), candidate: null, canCheckWithBank: false, pendingDays: 40 },
    ] as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Starbucks']]));

    const data = (await call({ tool })) as {
      pending: { transaction: Record<string, unknown>; candidate: Record<string, unknown> | null }[];
    };

    expect(stuckPending).toHaveBeenCalledWith({ userId: 42 });
    expect(payeeNames).toHaveBeenCalledTimes(1);
    expect(data.pending).toHaveLength(2);
    expect(data.pending[0]).toMatchObject({
      transaction: { id: ID_1, payee: { id: PAYEE_ID, name: 'Starbucks' } },
      candidate: { id: ID_2, payee: null },
      pendingDays: 9,
    });
    expect(data.pending[0]!.transaction).not.toHaveProperty('userId');
    expect(data.pending[1]).toMatchObject({ transaction: { id: ID_3 }, candidate: null, pendingDays: 40 });
  });

  it('leaves out the bank-check flag, which only the app can act on', async () => {
    stuckPending.mockResolvedValue([
      { transaction: makeTx(), candidate: null, canCheckWithBank: true, pendingDays: 8 },
    ] as never);

    const data = (await call({ tool })) as { pending: Record<string, unknown>[] };

    expect(data.pending[0]).not.toHaveProperty('canCheckWithBank');
  });

  it('returns an empty list when nothing is stuck', async () => {
    stuckPending.mockResolvedValue([]);

    expect(await call({ tool })).toEqual({ pending: [] });
  });

  it('is a read tool: a read-only user may call it and no lock is checked', async () => {
    stuckPending.mockResolvedValue([]);
    lockCheck.mockResolvedValue(true);

    await call({ tool, extra: READ });

    expect(lockCheck).not.toHaveBeenCalled();
    expect(stuckPending).toHaveBeenCalled();
  });
});

describe.each([
  {
    name: 'remove_duplicate_transactions',
    register: registerRemoveDuplicateTransactions,
    service: remove,
    result: { removedIds: [ID_1, ID_2] },
  },
  {
    name: 'restore_removed_transactions',
    register: registerRestoreRemovedTransactions,
    service: restore,
    result: { restoredIds: [ID_1, ID_2] },
  },
  {
    name: 'keep_pending_as_booked',
    register: registerKeepPendingAsBooked,
    service: keepBooked,
    result: { updatedIds: [ID_1, ID_2] },
  },
])('$name', ({ name, register, service, result }) => {
  const tool = captureTools({ register })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name', () => {
    expect(tool.name).toBe(name);
  });

  it('declares the same fields as the REST body schema', () => {
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      Object.keys(reconciliationIdsBodySchema.shape).toSorted(),
    );
  });

  it('accepts 1 to the REST maximum of unique ids and refuses the rest', () => {
    expect(schema.safeParse({ transactionIds: [ID_1] }).success).toBe(true);
    expect(schema.safeParse({ transactionIds: ids(RECONCILIATION_REMOVE_MAX) }).success).toBe(true);
    expect(schema.safeParse({ transactionIds: [] }).success).toBe(false);
    expect(schema.safeParse({ transactionIds: ids(RECONCILIATION_REMOVE_MAX + 1) }).success).toBe(false);
    expect(schema.safeParse({ transactionIds: [ID_1, ID_1] }).success).toBe(false);
    expect(schema.safeParse({ transactionIds: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('calls the service for the caller with the ids and returns its result', async () => {
    service.mockResolvedValue(result as never);

    const data = await call({ tool, args: { transactionIds: [ID_1, ID_2] }, extra: WRITE });

    expect(service).toHaveBeenCalledWith({ userId: 42, transactionIds: [ID_1, ID_2] });
    expect(data).toEqual(result);
  });

  it('passes the service refusals through with their messages', async () => {
    service.mockRejectedValueOnce(new ValidationError({ message: 'Transfers cannot be reconciled' }));
    await expect(call({ tool, args: { transactionIds: [ID_1] }, extra: WRITE })).rejects.toThrow(
      'Transfers cannot be reconciled',
    );

    service.mockRejectedValueOnce(new NotFoundError({ message: 'Transaction not found' }));
    await expect(call({ tool, args: { transactionIds: [ID_1] }, extra: WRITE })).rejects.toThrow(
      'Transaction not found',
    );
  });

  it('needs finance:write, an editing plan and an unlocked base currency, with nothing changed otherwise', async () => {
    const args = { transactionIds: [ID_1] };

    await expect(call({ tool, args, extra: READ })).rejects.toThrow(/no longer includes editing|finance:write/);
    await expect(call({ tool, args, extra: makeExtra({ scopes: ['finance:read'] }) })).rejects.toThrow(/finance:write/);
    await expect(
      call({ tool, args, extra: makeExtra({ scopes: ['finance:read', 'finance:write'], readOnly: true }) }),
    ).rejects.toThrow(/no longer includes editing/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);

    expect(service).not.toHaveBeenCalled();
  });

  it('works with finance:write alone, not finance:delete', async () => {
    service.mockResolvedValue(result as never);

    await call({
      tool,
      args: { transactionIds: [ID_1] },
      extra: makeExtra({ scopes: ['finance:read', 'finance:write'] }),
    });

    expect(service).toHaveBeenCalledTimes(1);
  });
});

describe('remove_duplicate_transactions description', () => {
  const tool = captureTools({ register: registerRemoveDuplicateTransactions })[0]!;

  it('says removed rows can be restored and that their links are dropped', () => {
    expect(tool.config.description).toMatch(/restore_removed_transactions/);
    expect(tool.config.description).toMatch(/tracker|group|subscription/i);
  });
});

describe('restore_removed_transactions description', () => {
  const tool = captureTools({ register: registerRestoreRemovedTransactions })[0]!;

  it('points at the history that lists removed rows', () => {
    expect(tool.config.description).toMatch(/get_reconciliation_history/);
  });
});

describe('keep_pending_as_booked description', () => {
  const tool = captureTools({ register: registerKeepPendingAsBooked })[0]!;

  it('points at the list of stuck pending rows', () => {
    expect(tool.config.description).toMatch(/list_stuck_pending_transactions/);
  });
});

describe('merge_duplicate_transactions', () => {
  const tool = captureTools({ register: registerMergeDuplicateTransactions })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name', () => {
    expect(tool.name).toBe('merge_duplicate_transactions');
  });

  it('declares the same fields as the REST body schema', () => {
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      Object.keys(reconciliationMergeBodySchema.shape).toSorted(),
    );
  });

  it('accepts the REST minimum and maximum of ids with a survivor and refuses the rest', () => {
    expect(schema.safeParse({ transactionIds: [ID_1, ID_2], survivorId: ID_1 }).success).toBe(true);
    expect(schema.safeParse({ transactionIds: ids(RECONCILIATION_MERGE_MAX), survivorId: ids(1)[0] }).success).toBe(
      true,
    );
    expect(schema.safeParse({ transactionIds: ids(RECONCILIATION_MERGE_MIN - 1), survivorId: ID_1 }).success).toBe(
      false,
    );
    expect(schema.safeParse({ transactionIds: ids(RECONCILIATION_MERGE_MAX + 1), survivorId: ID_1 }).success).toBe(
      false,
    );
    expect(schema.safeParse({ transactionIds: [ID_1, ID_1], survivorId: ID_1 }).success).toBe(false);
    expect(schema.safeParse({ transactionIds: [ID_1, ID_2] }).success).toBe(false);
    expect(schema.safeParse({ transactionIds: [ID_1, ID_2], survivorId: 'nope' }).success).toBe(false);
  });

  it('merges the rows into the survivor for the caller and returns the removed ids', async () => {
    merge.mockResolvedValue({ removedIds: [ID_2] } as never);

    const data = await call({ tool, args: { transactionIds: [ID_1, ID_2], survivorId: ID_1 }, extra: WRITE });

    expect(merge).toHaveBeenCalledWith({ userId: 42, transactionIds: [ID_1, ID_2], survivorId: ID_1 });
    expect(data).toEqual({ removedIds: [ID_2] });
  });

  it('passes a survivor outside the selection through as the service refusal', async () => {
    merge.mockRejectedValue(new ValidationError({ message: 'The survivor must be one of the selected rows' }));

    await expect(
      call({ tool, args: { transactionIds: [ID_1, ID_2], survivorId: ID_3 }, extra: WRITE }),
    ).rejects.toThrow('The survivor must be one of the selected rows');
  });

  it('needs finance:write, an editing plan and an unlocked base currency, with nothing merged otherwise', async () => {
    const args = { transactionIds: [ID_1, ID_2], survivorId: ID_1 };

    await expect(call({ tool, args, extra: READ })).rejects.toThrow(/no longer includes editing|finance:write/);
    await expect(call({ tool, args, extra: makeExtra({ scopes: ['finance:read'] }) })).rejects.toThrow(/finance:write/);
    await expect(
      call({ tool, args, extra: makeExtra({ scopes: ['finance:read', 'finance:write'], readOnly: true }) }),
    ).rejects.toThrow(/no longer includes editing/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);

    expect(merge).not.toHaveBeenCalled();
  });

  it('is a finance:write tool, because restore_removed_transactions undoes it', async () => {
    merge.mockResolvedValue({ removedIds: [ID_2] } as never);

    await call({
      tool,
      args: { transactionIds: [ID_1, ID_2], survivorId: ID_1 },
      extra: makeExtra({ scopes: ['finance:read', 'finance:write'] }),
    });

    expect(merge).toHaveBeenCalledTimes(1);
  });

  it('says merged rows are restorable and what a restored row comes back without', () => {
    const description = tool.config.description!;

    expect(description).toMatch(/restore_removed_transactions/);
    expect(description).toMatch(/tracker/i);
    expect(description).toMatch(/group/i);
    expect(description).toMatch(/subscription/i);
    expect(description).toMatch(/survivor/i);
  });
});
