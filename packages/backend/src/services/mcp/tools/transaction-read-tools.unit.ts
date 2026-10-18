import { FEATURES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { transactionFilterFields } from '@controllers/transactions.controller/transaction-filters';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError, ValidationError } from '@js/errors';
import { getTransactionPortfolioLink } from '@services/investments/portfolios/transfers';
import { getPayeeNames } from '@services/payees/get-payee-names';
import { getTransactionGroups } from '@services/transaction-groups';
import { bulkDelete } from '@services/transactions/bulk-delete';
import { getTransactionById } from '@services/transactions/get-by-id';
import { getTransactionsByIds } from '@services/transactions/get-by-ids';
import { getTransactionsByTransferId } from '@services/transactions/get-by-transfer-id';
import { getPlannedSummary } from '@services/transactions/get-planned-summary';
import { getTransactions } from '@services/transactions/get-transactions';
import { getTransactionsSummary, resolveBulkTargetIds } from '@services/transactions/matching-transactions';
import { updateTransaction } from '@services/transactions/update-transaction';
import { getTransactionVentureLink } from '@services/venture/linking/get-transaction-venture-link.service';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test. The serializers pass the already API-shaped fakes through.
jest.mock('@services/transactions/get-transactions', () => ({ getTransactions: jest.fn() }));
jest.mock('@services/transactions/get-by-ids', () => ({ getTransactionsByIds: jest.fn() }));
jest.mock('@services/transactions/get-by-id', () => ({ getTransactionById: jest.fn() }));
jest.mock('@services/transactions/get-by-transfer-id', () => ({ getTransactionsByTransferId: jest.fn() }));
jest.mock('@services/transactions/get-planned-summary', () => ({ getPlannedSummary: jest.fn() }));
jest.mock('@services/transactions/matching-transactions', () => ({
  getTransactionsSummary: jest.fn(),
  resolveBulkTargetIds: jest.fn(),
}));
jest.mock('@services/transactions/bulk-delete', () => ({ bulkDelete: jest.fn() }));
jest.mock('@services/transactions/update-transaction', () => ({ updateTransaction: jest.fn() }));
jest.mock('@services/transaction-groups', () => ({ getTransactionGroups: jest.fn() }));
jest.mock('@services/payees/get-payee-names', () => ({ getPayeeNames: jest.fn() }));
jest.mock('@services/investments/portfolios/transfers', () => ({ getTransactionPortfolioLink: jest.fn() }));
jest.mock('@services/venture/linking/get-transaction-venture-link.service', () => ({
  getTransactionVentureLink: jest.fn(),
}));
jest.mock('@services/attachments/attachments.service', () => ({
  listAttachments: jest.fn(),
  deleteAttachment: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));
jest.mock('@root/serializers/transactions.serializer', () => ({
  serializeTransactions: (transactions: unknown) => transactions,
  serializeTransaction: (transaction: unknown) => transaction,
  serializeTransactionTuple: (tuple: unknown) => tuple,
}));

import { deleteAttachment, listAttachments } from '@services/attachments/attachments.service';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerBulkDeleteTransactions } from './bulk-delete-transactions';
import { registerConfirmPlannedTransaction } from './confirm-planned-transaction';
import { registerDeleteAttachment } from './delete-attachment';
import { registerGetPlannedSummary } from './get-planned-summary';
import { registerGetTransactionGroups } from './get-transaction-groups';
import { registerGetTransactionLinks } from './get-transaction-links';
import { registerGetTransactions } from './get-transactions';
import { registerGetTransactionsSummary } from './get-transactions-summary';
import { registerListTransactionAttachments } from './list-transaction-attachments';
import { registerSearchTransactions } from './search-transactions';

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE = makeExtra({ scopes: ['finance:read', 'finance:delete'], features: [FEATURES.attachments] });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const searchService = jest.mocked(getTransactions);
const byIds = jest.mocked(getTransactionsByIds);
const byId = jest.mocked(getTransactionById);
const byTransferId = jest.mocked(getTransactionsByTransferId);
const plannedSummary = jest.mocked(getPlannedSummary);
const summary = jest.mocked(getTransactionsSummary);
const resolveTargets = jest.mocked(resolveBulkTargetIds);
const bulkDeleteService = jest.mocked(bulkDelete);
const updateService = jest.mocked(updateTransaction);
const groupsService = jest.mocked(getTransactionGroups);
const payeeNames = jest.mocked(getPayeeNames);
const portfolioLink = jest.mocked(getTransactionPortfolioLink);
const ventureLink = jest.mocked(getTransactionVentureLink);
const attachmentsList = jest.mocked(listAttachments);
const attachmentDelete = jest.mocked(deleteAttachment);

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const PAYEE_ID = '44444444-4444-4444-8444-444444444444';

/** An API-shaped transaction, as the REST serializer would hand it to the slimmer. */
const makeTx = (patch: Record<string, unknown> = {}) => ({
  id: ID_1,
  time: '2026-10-01T10:00:00.000Z',
  amount: 12.5,
  refAmount: 12.5,
  currencyCode: 'USD',
  note: 'coffee',
  transactionType: TRANSACTION_TYPES.expense,
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  accountId: ACCOUNT_ID,
  categoryId: null,
  isPlanned: false,
  payeeId: null,
  ...patch,
});

const makeIds = (count: number) =>
  Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

const call = async ({
  tool,
  args,
  extra = makeExtra(),
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
  payeeNames.mockResolvedValue(new Map());
});

describe('search_transactions', () => {
  const tool = captureTools({ register: registerSearchTransactions })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts the isPlanned and payeeIds filters and rejects a payee id that is not an id', () => {
    expect(schema.safeParse({ isPlanned: true, payeeIds: [PAYEE_ID] }).success).toBe(true);
    expect(schema.safeParse({ payeeIds: ['starbucks'] }).success).toBe(false);
  });

  it('passes isPlanned and payeeIds to the transactions query', async () => {
    searchService.mockResolvedValue([] as never);

    await call({ tool, args: { isPlanned: true, payeeIds: [PAYEE_ID], endDate: '2027-01-01T00:00:00.000Z' } });

    expect(searchService).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        isPlanned: true,
        payeeIds: [PAYEE_ID],
        endDate: '2027-01-01T00:00:00.000Z',
      }),
    );
  });

  it('leaves isPlanned and payeeIds out of the query when they are not given', async () => {
    searchService.mockResolvedValue([] as never);

    await call({ tool, args: {} });

    const filters = searchService.mock.calls[0]![0];
    expect(filters.isPlanned).toBeUndefined();
    expect(filters.payeeIds).toBeUndefined();
  });

  it('returns each transaction with its payee, from one name lookup for the page', async () => {
    searchService.mockResolvedValue([
      makeTx({ id: ID_1, payeeId: PAYEE_ID }),
      makeTx({ id: ID_2, payeeId: PAYEE_ID }),
      makeTx({ id: '55555555-5555-4555-8555-555555555555', payeeId: null }),
    ] as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Starbucks']]));

    const data = (await call({ tool, args: {} })) as { transactions: Record<string, unknown>[] };

    expect(payeeNames).toHaveBeenCalledTimes(1);
    expect(payeeNames).toHaveBeenCalledWith({ userId: 42, payeeIds: [PAYEE_ID] });
    expect(data.transactions.map((tx) => tx.payee)).toEqual([
      { id: PAYEE_ID, name: 'Starbucks' },
      { id: PAYEE_ID, name: 'Starbucks' },
      null,
    ]);
    expect(data.transactions[0]!.payeeId).toBe(PAYEE_ID);
  });

  it('describes the payee, the payeeIds filter, isPlanned and the endDate that hides future plans', () => {
    const description = tool.config.description!;

    expect(description).toMatch(/payee/i);
    const field = (name: string) => (tool.config.inputSchema![name] as z.ZodType).description;
    expect(field('payeeIds')).toMatch(/get_payees/);
    expect(field('isPlanned')).toMatch(/endDate/);
    expect(field('endDate')).toMatch(/future|planned/i);
  });
});

describe('get_transaction_groups', () => {
  const tool = captureTools({ register: registerGetTransactionGroups })[0]!;

  it('returns the embedded transactions with their payee, from one name lookup', async () => {
    groupsService.mockResolvedValue([
      { id: 'g1', name: 'Trip', note: null, transactions: [makeTx({ payeeId: PAYEE_ID })] },
      { id: 'g2', name: 'Home', note: null, transactions: [makeTx({ id: ID_2, payeeId: PAYEE_ID })] },
    ] as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Starbucks']]));

    const data = (await call({ tool, args: { includeTransactions: true } })) as {
      transactions: { payee: unknown }[];
    }[];

    expect(payeeNames).toHaveBeenCalledTimes(1);
    expect(payeeNames).toHaveBeenCalledWith({ userId: 42, payeeIds: [PAYEE_ID] });
    expect(data.flatMap((group) => group.transactions.map((tx) => tx.payee))).toEqual([
      { id: PAYEE_ID, name: 'Starbucks' },
      { id: PAYEE_ID, name: 'Starbucks' },
    ]);
  });

  it('looks up no payees for the aggregate view', async () => {
    groupsService.mockResolvedValue([
      { id: 'g1', name: 'Trip', note: null, transactionCount: 2, dateFrom: null, dateTo: null },
    ] as never);

    await call({ tool, args: {} });

    expect(payeeNames).not.toHaveBeenCalled();
  });
});

describe('get_transactions', () => {
  const tool = captureTools({ register: registerGetTransactions })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('accepts 1 to 50 ids and refuses 0 or 51, the limit of the by-ids service', () => {
    expect(schema.safeParse({ ids: makeIds(1) }).success).toBe(true);
    expect(schema.safeParse({ ids: makeIds(50) }).success).toBe(true);
    expect(schema.safeParse({ ids: makeIds(51) }).success).toBe(false);
    expect(schema.safeParse({ ids: [] }).success).toBe(false);
  });

  it('reads by ids and returns the payee', async () => {
    byIds.mockResolvedValue([makeTx({ payeeId: PAYEE_ID })] as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Starbucks']]));

    const data = (await call({ tool, args: { ids: [ID_1, ID_2] } })) as { transactions: Record<string, unknown>[] };

    expect(byIds).toHaveBeenCalledWith({ userId: 42, ids: [ID_1, ID_2] });
    expect(byTransferId).not.toHaveBeenCalled();
    expect(data.transactions[0]).toMatchObject({ id: ID_1, payee: { id: PAYEE_ID, name: 'Starbucks' } });
  });

  it('reads both legs of a transfer by transferId', async () => {
    byTransferId.mockResolvedValue([makeTx({ id: ID_1 }), makeTx({ id: ID_2 })] as never);

    const data = (await call({ tool, args: { transferId: 'transfer-1' } })) as { transactions: { id: string }[] };

    expect(byTransferId).toHaveBeenCalledWith({ transferId: 'transfer-1', userId: 42 });
    expect(byIds).not.toHaveBeenCalled();
    expect(data.transactions.map((tx) => tx.id)).toEqual([ID_1, ID_2]);
  });

  it('shows which rows are paired transfers: each carries its transferId and transferNature', async () => {
    byTransferId.mockResolvedValue([
      makeTx({ id: ID_1, transferId: 'transfer-1', transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
      makeTx({ id: ID_2, transferId: 'transfer-1', transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer }),
    ] as never);

    const data = (await call({ tool, args: { transferId: 'transfer-1' } })) as {
      transactions: { transferId: string | null; transferNature: string }[];
    };

    expect(data.transactions.map((tx) => [tx.transferId, tx.transferNature])).toEqual([
      ['transfer-1', TRANSACTION_TRANSFER_NATURE.common_transfer],
      ['transfer-1', TRANSACTION_TRANSFER_NATURE.common_transfer],
    ]);
  });

  it('reads one by one, with splits and tags, when includeSplits is set, and skips an id that is not visible', async () => {
    byId.mockImplementation((async ({ id }: { id: string }) =>
      id === ID_1
        ? { tx: makeTx({ id, splits: [{ categoryId: 'c1', amount: 5, note: null }] }), access: {} }
        : null) as never);

    const data = (await call({ tool, args: { ids: [ID_1, ID_2], includeSplits: true } })) as {
      transactions: { id: string; splits?: unknown[] }[];
    };

    expect(byId).toHaveBeenCalledWith({ id: ID_1, userId: 42, includeSplits: true, includeTags: true });
    expect(byId).toHaveBeenCalledWith({ id: ID_2, userId: 42, includeSplits: true, includeTags: true });
    expect(byIds).not.toHaveBeenCalled();
    expect(data.transactions.map((tx) => tx.id)).toEqual([ID_1]);
    expect(data.transactions[0]!.splits).toEqual([{ categoryId: 'c1', amount: 5, note: null }]);
  });

  it.each([
    { label: 'neither ids nor transferId', args: {} },
    { label: 'both ids and transferId', args: { ids: [ID_1], transferId: 'transfer-1' } },
  ])('rejects $label without reading anything', async ({ args }) => {
    await expect(call({ tool, args })).rejects.toThrow(/exactly one of "ids" and "transferId"/);

    expect(byIds).not.toHaveBeenCalled();
    expect(byTransferId).not.toHaveBeenCalled();
    expect(byId).not.toHaveBeenCalled();
  });
});

describe('get_transactions_summary', () => {
  const tool = captureTools({ register: registerGetTransactionsSummary })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('offers every filter field of the transaction list', () => {
    const missing = Object.keys(transactionFilterFields).filter((field) => !(field in tool.config.inputSchema!));

    expect(missing).toEqual([]);
  });

  it('maps the filters for the service as the REST controller does and returns the summary', async () => {
    summary.mockResolvedValue({ count: 3, income: 0, expense: 30, net: -30, transfers: 0 });

    const data = await call({
      tool,
      args: {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-31T23:59:59.000Z',
        accountIds: [ACCOUNT_ID],
        payeeIds: [PAYEE_ID],
        isPlanned: true,
        amountGte: 5,
        noteSearch: 'coffee, tea',
      },
    });

    expect(data).toEqual({ count: 3, income: 0, expense: 30, net: -30, transfers: 0 });
    const filters = summary.mock.calls[0]![0];
    expect(filters).toMatchObject({
      userId: 42,
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-31T23:59:59.000Z',
      accountIds: [ACCOUNT_ID],
      payeeIds: [PAYEE_ID],
      isPlanned: true,
      noteSearch: ['coffee', 'tea'],
    });
    expect(filters.amountGte!.toNumber()).toBe(5);
    expect(filters).not.toHaveProperty('from');
  });

  it('refuses a reversed date range and a reversed amount range', async () => {
    await expect(
      call({ tool, args: { from: '2026-11-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' } }),
    ).rejects.toThrow();
    await expect(call({ tool, args: { amountGte: 10, amountLte: 5 } })).rejects.toThrow();

    expect(summary).not.toHaveBeenCalled();
  });

  it('accepts a read-only scope: it is a read tool', async () => {
    summary.mockResolvedValue({ count: 0, income: 0, expense: 0, net: 0, transfers: 0 });

    await call({ tool, args: {}, extra: makeExtra({ scopes: ['finance:read'], readOnly: true }) });

    expect(summary).toHaveBeenCalled();
  });

  it('accepts the shape it declares', () => {
    expect(
      schema.safeParse({
        isPlanned: false,
        tagIds: ['blank'],
        transferNatures: [TRANSACTION_TRANSFER_NATURE.common_transfer],
      }).success,
    ).toBe(true);
  });
});

describe('get_planned_summary', () => {
  const tool = captureTools({ register: registerGetPlannedSummary })[0]!;

  it('returns the planned totals of the caller', async () => {
    const entries = [
      {
        accountId: ACCOUNT_ID,
        currencyCode: 'USD',
        plannedDelta: -40,
        refPlannedDelta: -40,
        count: 2,
        latestTime: '2026-11-01T00:00:00.000Z',
      },
    ];
    plannedSummary.mockResolvedValue(entries as never);

    expect(await call({ tool })).toEqual(entries);
    expect(plannedSummary).toHaveBeenCalledWith({ userId: 42 });
  });
});

describe('confirm_planned_transaction', () => {
  const tool = captureTools({ register: registerConfirmPlannedTransaction })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  const planned = ({ time }: { time: Date }) => ({ tx: { id: ID_1, isPlanned: true, time }, access: {} }) as never;
  const HOUR = 60 * 60 * 1000;

  beforeEach(() => {
    updateService.mockResolvedValue([makeTx({ isPlanned: false, payeeId: PAYEE_ID })] as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Starbucks']]));
  });

  it('confirms a plan whose date has passed without touching its time', async () => {
    byId.mockResolvedValue(planned({ time: new Date(Date.now() - HOUR) }));

    await call({ tool, args: { transactionId: ID_1 }, extra: WRITE });

    expect(updateService).toHaveBeenCalledTimes(1);
    expect(updateService).toHaveBeenCalledWith({ id: ID_1, userId: 42, isPlanned: false });
  });

  it('moves a plan that is still in the future to now, as the web app does', async () => {
    byId.mockResolvedValue(planned({ time: new Date(Date.now() + 24 * HOUR) }));
    const before = Date.now();

    await call({ tool, args: { transactionId: ID_1 }, extra: WRITE });

    const payload = updateService.mock.calls[0]![0];
    expect(payload).toMatchObject({ id: ID_1, userId: 42, isPlanned: false });
    expect(payload.time!.getTime()).toBeGreaterThanOrEqual(before);
    expect(payload.time!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('uses the time the caller gives, past or future', async () => {
    byId.mockResolvedValue(planned({ time: new Date(Date.now() + 24 * HOUR) }));

    await call({ tool, args: { transactionId: ID_1, time: '2026-10-02T08:30:00.000Z' }, extra: WRITE });

    expect(updateService).toHaveBeenCalledWith({
      id: ID_1,
      userId: 42,
      isPlanned: false,
      time: new Date('2026-10-02T08:30:00.000Z'),
    });
  });

  it('returns the confirmed transaction with its payee', async () => {
    byId.mockResolvedValue(planned({ time: new Date(Date.now() - HOUR) }));

    const data = (await call({ tool, args: { transactionId: ID_1 }, extra: WRITE })) as Record<string, unknown>[];

    expect(data[0]).toMatchObject({ id: ID_1, isPlanned: false, payee: { id: PAYEE_ID, name: 'Starbucks' } });
  });

  it('passes the refusal on a bank-connected account through with its message', async () => {
    byId.mockResolvedValue(planned({ time: new Date(Date.now() - HOUR) }));
    updateService.mockRejectedValue(new ValidationError({ message: 'Bank plans are confirmed by sync' }));

    await expect(call({ tool, args: { transactionId: ID_1 }, extra: WRITE })).rejects.toThrow(
      'Bank plans are confirmed by sync',
    );
  });

  it('refuses a transaction that is not planned, and one that does not exist', async () => {
    byId.mockResolvedValueOnce({ tx: { id: ID_1, isPlanned: false, time: new Date() }, access: {} } as never);
    await expect(call({ tool, args: { transactionId: ID_1 }, extra: WRITE })).rejects.toThrow(
      /not a planned transaction/,
    );

    byId.mockResolvedValueOnce(null);
    await expect(call({ tool, args: { transactionId: ID_1 }, extra: WRITE })).rejects.toThrow();

    expect(updateService).not.toHaveBeenCalled();
  });

  it('rejects an invalid time', () => {
    expect(schema.safeParse({ transactionId: ID_1, time: 'tomorrow' }).success).toBe(false);
    expect(schema.safeParse({ transactionId: ID_1, time: '2026-10-02T08:30:00.000Z' }).success).toBe(true);
  });

  it('needs finance:write, an editing plan and an unlocked base currency, with nothing read or written otherwise', async () => {
    const args = { transactionId: ID_1 };

    await expect(call({ tool, args, extra: makeExtra({ scopes: ['finance:read'] }) })).rejects.toThrow(/finance:write/);
    await expect(
      call({ tool, args, extra: makeExtra({ scopes: ['finance:read', 'finance:write'], readOnly: true }) }),
    ).rejects.toThrow(/no longer includes editing/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);

    expect(byId).not.toHaveBeenCalled();
    expect(updateService).not.toHaveBeenCalled();
  });

  it('says in its description that bank plans are confirmed by sync and that a linked subscription period settles', () => {
    expect(tool.config.description).toMatch(/bank/i);
    expect(tool.config.description).toMatch(/sync/i);
    expect(tool.config.description).toMatch(/subscription/i);
  });
});

describe('bulk_delete_transactions', () => {
  const tool = captureTools({ register: registerBulkDeleteTransactions })[0]!;

  beforeEach(() => {
    resolveTargets.mockResolvedValue([ID_1, ID_2]);
    bulkDeleteService.mockResolvedValue({ deletedCount: 2, deletedIds: [ID_1, ID_2] });
  });

  it('deletes explicit ids', async () => {
    resolveTargets.mockResolvedValue([ID_1]);
    bulkDeleteService.mockResolvedValue({ deletedCount: 1, deletedIds: [ID_1] });

    const data = await call({ tool, args: { transactionIds: [ID_1] }, extra: DELETE });

    expect(resolveTargets).toHaveBeenCalledWith({ userId: 42, transactionIds: [ID_1], selection: undefined });
    expect(bulkDeleteService).toHaveBeenCalledWith({ userId: 42, transactionIds: [ID_1] });
    expect(data).toEqual({ deletedCount: 1, deletedIds: [ID_1] });
  });

  it('deletes what the filters match, less the excluded ids, with the filters mapped for the service', async () => {
    await call({
      tool,
      args: {
        filters: { from: '2026-10-01T00:00:00.000Z', accountIds: [ACCOUNT_ID], isPlanned: true, amountGte: 5 },
        excludedIds: [ID_2],
      },
      extra: DELETE,
    });

    const target = resolveTargets.mock.calls[0]![0];
    expect(target.transactionIds).toBeUndefined();
    expect(target.selection).toMatchObject({
      filters: { startDate: '2026-10-01T00:00:00.000Z', accountIds: [ACCOUNT_ID], isPlanned: true },
      excludedIds: [ID_2],
    });
    expect(target.selection!.filters.amountGte!.toNumber()).toBe(5);
    expect(bulkDeleteService).toHaveBeenCalledWith({ userId: 42, transactionIds: [ID_1, ID_2] });
  });

  it.each([
    { label: 'neither transactionIds nor filters', args: {} },
    {
      label: 'both transactionIds and filters',
      args: { transactionIds: [ID_1], filters: { accountIds: [ACCOUNT_ID] } },
    },
    { label: 'excludedIds with explicit ids', args: { transactionIds: [ID_1], excludedIds: [ID_2] } },
    { label: 'an unknown filter key', args: { filters: { accountId: ACCOUNT_ID } } },
    { label: 'an empty id list', args: { transactionIds: [] } },
  ])('rejects $label before resolving or deleting anything', async ({ args }) => {
    await expect(call({ tool, args, extra: DELETE })).rejects.toThrow();

    expect(resolveTargets).not.toHaveBeenCalled();
    expect(bulkDeleteService).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'empty filters', filters: {} },
    { label: 'filters that are all empty lists', filters: { accountIds: [], categoryIds: [], tagIds: [] } },
    { label: 'only exclude flags switched off', filters: { excludeTransfer: false, excludeRefunds: false } },
    { label: 'only the include-everything operations', filters: { transferFilter: 'all', refundFilter: 'all' } },
    { label: 'an empty note search', filters: { noteSearch: '' } },
    { label: 'a note search of only separators', filters: { noteSearch: ',' } },
    { label: 'a note search of only whitespace', filters: { noteSearch: '  ,  ' } },
    { label: 'a lone keepRefundsForTxId', filters: { keepRefundsForTxId: ID_1 } },
    {
      label: 'keepRefundsForTxId with excludeRefundTxs off',
      filters: { keepRefundsForTxId: ID_1, excludeRefundTxs: false },
    },
    { label: 'an empty transferNatures list', filters: { transferNatures: [] } },
    {
      label: 'a legacy exclude flag overridden by the all operation',
      filters: { excludeTransfer: true, transferFilter: 'all' },
    },
    { label: 'only no-op values mixed together', filters: { noteSearch: '', accountIds: [], excludeRefunds: false } },
  ])(
    'refuses $label, which would delete everything the caller owns, before resolving anything',
    async ({ filters }) => {
      await expect(call({ tool, args: { filters }, extra: DELETE })).rejects.toThrow(/at least one filter/);
      await expect(call({ tool, args: { filters, excludedIds: [ID_2] }, extra: DELETE })).rejects.toThrow(
        /at least one filter/,
      );

      expect(resolveTargets).not.toHaveBeenCalled();
      expect(bulkDeleteService).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: 'a date bound', filters: { from: '2026-10-01T00:00:00.000Z' } },
    { label: 'an account', filters: { accountIds: [ACCOUNT_ID] } },
    { label: 'a note search', filters: { noteSearch: 'coffee' } },
    { label: 'a transaction type', filters: { transactionType: TRANSACTION_TYPES.expense } },
    { label: 'a switched-on flag', filters: { excludeTransfer: true } },
    { label: 'the only-refunds operation', filters: { refundFilter: 'only' } },
    { label: 'a note search with a real term among separators', filters: { noteSearch: ' , coffee,' } },
    {
      label: 'the refund side switched on, with the transaction to keep',
      filters: { excludeRefundTxs: true, keepRefundsForTxId: ID_1 },
    },
    { label: 'a legacy exclude flag with no operation set', filters: { excludeRefunds: true } },
    { label: 'an exact transfer natures list', filters: { transferNatures: ['not_transfer'] } },
  ])('still deletes by $label alone', async ({ filters }) => {
    await call({ tool, args: { filters }, extra: DELETE });

    expect(resolveTargets).toHaveBeenCalledTimes(1);
    expect(bulkDeleteService).toHaveBeenCalledWith({ userId: 42, transactionIds: [ID_1, ID_2] });
  });

  it('says in its description that an unfiltered delete is refused', () => {
    expect(tool.config.description).toMatch(/at least one filter/i);
  });

  it('passes the service refusals (bank rows, the maximum count) through with their message', async () => {
    bulkDeleteService.mockRejectedValue(new ValidationError({ message: 'Cannot delete bank transactions' }));

    await expect(call({ tool, args: { transactionIds: [ID_1] }, extra: DELETE })).rejects.toThrow(
      'Cannot delete bank transactions',
    );
  });

  it('needs finance:delete, an editing plan and an unlocked base currency, with nothing deleted otherwise', async () => {
    const args = { transactionIds: [ID_1] };

    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/finance:delete/);
    await expect(
      call({ tool, args, extra: makeExtra({ scopes: ['finance:read', 'finance:delete'], readOnly: true }) }),
    ).rejects.toThrow(/no longer includes editing/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: DELETE })).rejects.toThrow(LOCKED);

    expect(resolveTargets).not.toHaveBeenCalled();
    expect(bulkDeleteService).not.toHaveBeenCalled();
  });
});

describe('get_transaction_links', () => {
  const tool = captureTools({ register: registerGetTransactionLinks })[0]!;

  const PORTFOLIO = { transferId: 't1', portfolioId: 'p1', portfolioName: 'Brokerage' };
  const VENTURE = { dealId: 'd1', dealName: 'Acme', isDealDeleted: false };

  it('returns both links', async () => {
    portfolioLink.mockResolvedValue(PORTFOLIO as never);
    ventureLink.mockResolvedValue(VENTURE);

    expect(await call({ tool, args: { transactionId: ID_1 } })).toEqual({
      portfolioLink: PORTFOLIO,
      ventureLink: VENTURE,
    });
    expect(portfolioLink).toHaveBeenCalledWith({ userId: 42, transactionId: ID_1 });
    expect(ventureLink).toHaveBeenCalledWith({ userId: 42, transactionId: ID_1 });
  });

  it('returns null for a link the transaction does not have', async () => {
    portfolioLink.mockRejectedValue(new NotFoundError({ message: 'no portfolio transfer' }));
    ventureLink.mockResolvedValue(VENTURE);

    expect(await call({ tool, args: { transactionId: ID_1 } })).toEqual({ portfolioLink: null, ventureLink: VENTURE });

    portfolioLink.mockResolvedValue(PORTFOLIO as never);
    ventureLink.mockRejectedValue(new NotFoundError({ message: 'no venture event' }));

    expect(await call({ tool, args: { transactionId: ID_1 } })).toEqual({
      portfolioLink: PORTFOLIO,
      ventureLink: null,
    });
  });

  it('does not hide a failure that is not "no link"', async () => {
    portfolioLink.mockRejectedValue(new Error('database is down'));
    ventureLink.mockResolvedValue(VENTURE);

    await expect(call({ tool, args: { transactionId: ID_1 } })).rejects.toThrow('database is down');
  });
});

describe('list_transaction_attachments', () => {
  const tool = captureTools({ register: registerListTransactionAttachments })[0]!;

  it('lists the files of a transaction without the owner id, and needs no feature', async () => {
    attachmentsList.mockResolvedValue([
      {
        id: 'a1',
        transactionId: ID_1,
        userId: 42,
        filename: 'receipt.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
      },
    ] as never);

    const data = await call({ tool, args: { transactionId: ID_1 }, extra: makeExtra({ scopes: ['finance:read'] }) });

    expect(attachmentsList).toHaveBeenCalledWith({ userId: 42, transactionId: ID_1 });
    expect(data).toEqual([
      {
        id: 'a1',
        transactionId: ID_1,
        filename: 'receipt.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ]);
  });
});

describe('delete_attachment', () => {
  const tool = captureTools({ register: registerDeleteAttachment })[0]!;
  const ATTACHMENT_ID = '66666666-6666-4666-8666-666666666666';

  it('deletes the attachment', async () => {
    attachmentDelete.mockResolvedValue();

    expect(await call({ tool, args: { attachmentId: ATTACHMENT_ID }, extra: DELETE })).toEqual({
      deleted: true,
      attachmentId: ATTACHMENT_ID,
    });
    expect(attachmentDelete).toHaveBeenCalledWith({ userId: 42, id: ATTACHMENT_ID });
  });

  it('is refused on a plan without attachments, as the REST route is', async () => {
    const noFeature = makeExtra({ scopes: ['finance:read', 'finance:delete'], features: [] });

    await expect(call({ tool, args: { attachmentId: ATTACHMENT_ID }, extra: noFeature })).rejects.toThrow(
      'This feature is not included in your current plan.',
    );
    expect(attachmentDelete).not.toHaveBeenCalled();
  });

  it('needs finance:delete and an editing plan', async () => {
    const args = { attachmentId: ATTACHMENT_ID };

    await expect(
      call({
        tool,
        args,
        extra: makeExtra({ scopes: ['finance:read', 'finance:write'], features: [FEATURES.attachments] }),
      }),
    ).rejects.toThrow(/finance:delete/);
    await expect(
      call({
        tool,
        args,
        extra: makeExtra({
          scopes: ['finance:read', 'finance:delete'],
          features: [FEATURES.attachments],
          readOnly: true,
        }),
      }),
    ).rejects.toThrow(/no longer includes editing/);

    expect(attachmentDelete).not.toHaveBeenCalled();
  });

  it('does not check the base-currency lock: its REST route has none', async () => {
    lockCheck.mockResolvedValue(true);
    attachmentDelete.mockResolvedValue();

    await call({ tool, args: { attachmentId: ATTACHMENT_ID }, extra: DELETE });

    expect(lockCheck).not.toHaveBeenCalled();
    expect(attachmentDelete).toHaveBeenCalled();
  });
});
