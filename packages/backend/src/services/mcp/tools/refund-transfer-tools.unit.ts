import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError, ValidationError } from '@js/errors';
import { getPayeeNames } from '@services/payees/get-payee-names';
import { bulkScanTransferRecommendations } from '@services/transactions/transactions-linking/bulk-scan-transfer-recommendations.service';
import { dismissTransferSuggestion } from '@services/transactions/transactions-linking/dismiss-transfer-suggestion.service';
import { getTransferRecommendations } from '@services/transactions/transactions-linking/get-transfer-recommendations.service';
import {
  bulkScanBodySchema,
  dismissBodySchema,
  recommendationQuerySchema,
} from '@services/transactions/transactions-linking/recommendation-schemas';
import { getRefundsForTransactionById } from '@services/tx-refunds/get-refund-for-transaction-by-id.service';
import { getRefundRecommendations } from '@services/tx-refunds/get-refund-recommendations.service';
import { getRefund } from '@services/tx-refunds/get-refund.service';
import { getRefundTransactions } from '@services/tx-refunds/get-refunds.service';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test. The serializers pass the already API-shaped fakes through.
jest.mock('@services/tx-refunds/get-refund-recommendations.service', () => ({ getRefundRecommendations: jest.fn() }));
jest.mock('@services/tx-refunds/get-refund.service', () => ({ getRefund: jest.fn() }));
jest.mock('@services/tx-refunds/get-refunds.service', () => ({ getRefundTransactions: jest.fn() }));
jest.mock('@services/tx-refunds/get-refund-for-transaction-by-id.service', () => ({
  getRefundsForTransactionById: jest.fn(),
}));
jest.mock('@services/transactions/transactions-linking/get-transfer-recommendations.service', () => ({
  getTransferRecommendations: jest.fn(),
}));
jest.mock('@services/transactions/transactions-linking/bulk-scan-transfer-recommendations.service', () => ({
  bulkScanTransferRecommendations: jest.fn(),
}));
jest.mock('@services/transactions/transactions-linking/dismiss-transfer-suggestion.service', () => ({
  dismissTransferSuggestion: jest.fn(),
}));
jest.mock('@services/payees/get-payee-names', () => ({ getPayeeNames: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));
jest.mock('@root/serializers/transactions.serializer', () => ({
  serializeTransactions: (transactions: unknown) => transactions,
  serializeTransaction: (transaction: unknown) => transaction,
}));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerDismissTransferSuggestion } from './dismiss-transfer-suggestion';
import { registerGetRefundRecommendations } from './get-refund-recommendations';
import { registerGetRefunds } from './get-refunds';
import { registerGetTransferRecommendations } from './get-transfer-recommendations';
import { registerListTransferSuggestions } from './list-transfer-suggestions';

const READ = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const payeeNames = jest.mocked(getPayeeNames);
const refundRecommendations = jest.mocked(getRefundRecommendations);
const transferRecommendations = jest.mocked(getTransferRecommendations);
const bulkScan = jest.mocked(bulkScanTransferRecommendations);
const dismiss = jest.mocked(dismissTransferSuggestion);
const refundsForTransaction = jest.mocked(getRefundsForTransactionById);
const refundPair = jest.mocked(getRefund);
const refundList = jest.mocked(getRefundTransactions);

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';
const PAYEE_ID = '55555555-5555-4555-8555-555555555555';

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

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
  payeeNames.mockResolvedValue(new Map());
});

describe('get_refunds', () => {
  const tool = captureTools({ register: registerGetRefunds })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  const makeRefund = (patch: Record<string, unknown> = {}) => ({
    id: 'refund-1',
    userId: 42,
    originalTxId: ID_1,
    refundTxId: ID_2,
    splitId: null,
    createdAt: new Date('2026-10-02T00:00:00.000Z'),
    originalTransaction: makeTx({ id: ID_1, payeeId: PAYEE_ID }),
    refundTransaction: makeTx({ id: ID_2, transactionType: TRANSACTION_TYPES.income }),
    ...patch,
  });

  it('accepts the three modes and refuses a bad id, page or limit', () => {
    expect(schema.safeParse({ transactionId: ID_1 }).success).toBe(true);
    expect(schema.safeParse({ originalTxId: ID_1, refundTxId: ID_2 }).success).toBe(true);
    expect(schema.safeParse({ page: 2, limit: 10, categoryId: CATEGORY_ID, accountId: ACCOUNT_ID }).success).toBe(true);
    expect(schema.safeParse({ transactionId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ page: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 101 }).success).toBe(false);
    expect(schema.safeParse({ transactionType: 'swap' }).success).toBe(false);
  });

  it('reads the refunds of one transaction, with the payee on both sides of each pair', async () => {
    refundsForTransaction.mockResolvedValue([makeRefund()] as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Starbucks']]));

    const data = (await call({ tool, args: { transactionId: ID_1 } })) as {
      refunds: {
        id: string;
        originalTransaction: Record<string, unknown>;
        refundTransaction: Record<string, unknown>;
      }[];
    };

    expect(refundsForTransaction).toHaveBeenCalledWith({ userId: 42, transactionId: ID_1 });
    expect(refundList).not.toHaveBeenCalled();
    expect(payeeNames).toHaveBeenCalledTimes(1);
    expect(data.refunds).toHaveLength(1);
    expect(data.refunds[0]).toMatchObject({
      id: 'refund-1',
      originalTxId: ID_1,
      refundTxId: ID_2,
      originalTransaction: { id: ID_1, payee: { id: PAYEE_ID, name: 'Starbucks' } },
      refundTransaction: { id: ID_2, payee: null },
    });
    expect(data.refunds[0]!.originalTransaction).not.toHaveProperty('userId');
  });

  it('reads one refund pair', async () => {
    refundPair.mockResolvedValue(makeRefund() as never);

    const data = (await call({ tool, args: { originalTxId: ID_1, refundTxId: ID_2 } })) as {
      refunds: { id: string }[];
    };

    expect(refundPair).toHaveBeenCalledWith({ userId: 42, originalTxId: ID_1, refundTxId: ID_2 });
    expect(data.refunds.map((refund) => refund.id)).toEqual(['refund-1']);
  });

  it('passes a missing pair through as the service not-found error', async () => {
    refundPair.mockRejectedValue(new NotFoundError({ message: 'Refund link not found' }));

    await expect(call({ tool, args: { originalTxId: ID_1, refundTxId: ID_2 } })).rejects.toThrow(
      'Refund link not found',
    );
  });

  it('lists refunds with the filters and a page, returning the meta', async () => {
    refundList.mockResolvedValue({ rows: [makeRefund()], meta: { total: 7, page: 2, limit: 5 } } as never);

    const data = (await call({
      tool,
      args: {
        page: 2,
        limit: 5,
        categoryId: CATEGORY_ID,
        accountId: ACCOUNT_ID,
        transactionType: TRANSACTION_TYPES.expense,
      },
    })) as { refunds: unknown[]; meta: unknown };

    expect(refundList).toHaveBeenCalledWith({
      userId: 42,
      page: 2,
      limit: 5,
      categoryId: CATEGORY_ID,
      accountId: ACCOUNT_ID,
      transactionType: TRANSACTION_TYPES.expense,
    });
    expect(data.refunds).toHaveLength(1);
    expect(data.meta).toEqual({ total: 7, page: 2, limit: 5 });
  });

  it('lists the first page of 20 when given nothing', async () => {
    refundList.mockResolvedValue({ rows: [], meta: { total: 0, page: 1, limit: 20 } } as never);

    await call({ tool, args: {} });

    expect(refundList).toHaveBeenCalledWith({ userId: 42, page: 1, limit: 20 });
  });

  it.each([
    { label: 'a transaction id with a pair', args: { transactionId: ID_1, originalTxId: ID_1, refundTxId: ID_2 } },
    { label: 'only half of a pair', args: { originalTxId: ID_1 } },
    { label: 'the other half of a pair', args: { refundTxId: ID_2 } },
    { label: 'a transaction id with list filters', args: { transactionId: ID_1, accountId: ACCOUNT_ID } },
    { label: 'a pair with a page', args: { originalTxId: ID_1, refundTxId: ID_2, page: 2 } },
  ])('rejects $label before reading anything', async ({ args }) => {
    await expect(call({ tool, args })).rejects.toThrow();

    expect(refundsForTransaction).not.toHaveBeenCalled();
    expect(refundPair).not.toHaveBeenCalled();
    expect(refundList).not.toHaveBeenCalled();
  });

  it('is a read tool: a read-only user may call it and no lock is checked', async () => {
    refundList.mockResolvedValue({ rows: [], meta: { total: 0, page: 1, limit: 20 } } as never);
    lockCheck.mockResolvedValue(true);

    await call({ tool, args: {}, extra: READ });

    expect(lockCheck).not.toHaveBeenCalled();
    expect(refundList).toHaveBeenCalled();
  });
});

describe.each([
  {
    name: 'get_refund_recommendations',
    register: registerGetRefundRecommendations,
    service: refundRecommendations,
  },
  {
    name: 'get_transfer_recommendations',
    register: registerGetTransferRecommendations,
    service: transferRecommendations,
  },
])('$name', ({ name, register, service }) => {
  const tool = captureTools({ register })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name', () => {
    expect(tool.name).toBe(name);
  });

  it('declares the same fields as the REST query schema', () => {
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      Object.keys(recommendationQuerySchema.shape).toSorted(),
    );
  });

  it('accepts a transaction id or the three form fields and refuses a bad value', () => {
    expect(schema.safeParse({ transactionId: ID_1 }).success).toBe(true);
    expect(
      schema.safeParse({ transactionType: TRANSACTION_TYPES.expense, originAmount: 50, accountId: ACCOUNT_ID }).success,
    ).toBe(true);
    expect(schema.safeParse({ transactionId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ originAmount: -5 }).success).toBe(false);
    expect(schema.safeParse({ transactionType: 'swap' }).success).toBe(false);
  });

  it('looks up by transaction id and returns the candidates with their payee', async () => {
    service.mockResolvedValue([makeTx({ id: ID_2, payeeId: PAYEE_ID })] as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Starbucks']]));

    const data = (await call({ tool, args: { transactionId: ID_1 } })) as { transactions: Record<string, unknown>[] };

    expect(service).toHaveBeenCalledWith({ userId: 42, transactionId: ID_1 });
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]).toMatchObject({ id: ID_2, payee: { id: PAYEE_ID, name: 'Starbucks' } });
  });

  it('looks up by form data', async () => {
    service.mockResolvedValue([]);

    const data = await call({
      tool,
      args: { transactionType: TRANSACTION_TYPES.income, originAmount: 50, accountId: ACCOUNT_ID },
    });

    expect(service).toHaveBeenCalledWith({
      userId: 42,
      transactionType: TRANSACTION_TYPES.income,
      originAmount: 50,
      accountId: ACCOUNT_ID,
    });
    expect(data).toEqual({ transactions: [] });
  });

  it.each([
    { label: 'nothing', args: {} },
    { label: 'only a transaction type', args: { transactionType: TRANSACTION_TYPES.expense } },
    { label: 'an amount without an account', args: { transactionType: TRANSACTION_TYPES.expense, originAmount: 50 } },
    {
      label: 'an account without an amount',
      args: { transactionType: TRANSACTION_TYPES.expense, accountId: ACCOUNT_ID },
    },
  ])('rejects $label with the REST message, without calling the service', async ({ args }) => {
    await expect(call({ tool, args })).rejects.toThrow(
      /Either transactionId OR \(transactionType, originAmount, accountId\)/,
    );

    expect(service).not.toHaveBeenCalled();
  });

  it('is a read tool: a read-only user may call it and no lock is checked', async () => {
    service.mockResolvedValue([]);
    lockCheck.mockResolvedValue(true);

    await call({ tool, args: { transactionId: ID_1 }, extra: READ });

    expect(lockCheck).not.toHaveBeenCalled();
    expect(service).toHaveBeenCalled();
  });
});

describe('list_transfer_suggestions', () => {
  const tool = captureTools({ register: registerListTransferSuggestions })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  const RANGE = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };

  it('declares the same fields as the REST body schema', () => {
    // AI review spends the user's AI allowance on every scan, so it stays a choice made in the app.
    const { aiReview: _aiReview, ...restBody } = bulkScanBodySchema.shape;
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(Object.keys(restBody).toSorted());
  });

  it('accepts a range with a limit up to 50 and refuses 51, 0 or a missing bound', () => {
    expect(schema.safeParse({ ...RANGE, limit: 50, offset: 0, includeOutOfWallet: true }).success).toBe(true);
    expect(schema.safeParse({ ...RANGE, limit: 51 }).success).toBe(false);
    expect(schema.safeParse({ ...RANGE, limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...RANGE, offset: -1 }).success).toBe(false);
    expect(schema.safeParse({ from: RANGE.from }).success).toBe(false);
  });

  it('scans with the defaults of the REST route and returns the pairs with their payee and confidence', async () => {
    bulkScan.mockResolvedValue({
      total: 1,
      items: [
        {
          expense: makeTx({ id: ID_1, payeeId: PAYEE_ID }),
          matches: [{ transaction: makeTx({ id: ID_2, transactionType: TRANSACTION_TYPES.income }), confidence: 87 }],
        },
      ],
    } as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Starbucks']]));

    const data = (await call({ tool, args: RANGE })) as {
      total: number;
      items: {
        expense: Record<string, unknown>;
        matches: { transaction: Record<string, unknown>; confidence: number }[];
      }[];
    };

    expect(bulkScan).toHaveBeenCalledWith({
      userId: 42,
      ...RANGE,
      limit: 20,
      offset: 0,
      includeOutOfWallet: false,
      aiReview: false,
    });
    expect(data.total).toBe(1);
    expect(data.items[0]!.expense).toMatchObject({ id: ID_1, payee: { id: PAYEE_ID, name: 'Starbucks' } });
    expect(data.items[0]!.matches[0]).toMatchObject({ transaction: { id: ID_2, payee: null }, confidence: 87 });
    expect(payeeNames).toHaveBeenCalledTimes(1);
  });

  it('passes the page and the out-of-wallet switch through', async () => {
    bulkScan.mockResolvedValue({ total: 0, items: [] });

    const data = await call({ tool, args: { ...RANGE, limit: 5, offset: 10, includeOutOfWallet: true } });

    expect(bulkScan).toHaveBeenCalledWith({
      userId: 42,
      ...RANGE,
      limit: 5,
      offset: 10,
      includeOutOfWallet: true,
      aiReview: false,
    });
    expect(data).toEqual({ total: 0, items: [] });
  });

  it('rejects a bound that is not an ISO datetime, as REST does, without scanning', async () => {
    await expect(call({ tool, args: { from: 'yesterday', to: RANGE.to } })).rejects.toThrow();

    expect(bulkScan).not.toHaveBeenCalled();
  });

  it('rejects a range whose start follows its end, as REST does, without scanning', async () => {
    await expect(call({ tool, args: { from: RANGE.to, to: RANGE.from } })).rejects.toThrow(/on or before/);

    expect(bulkScan).not.toHaveBeenCalled();
  });

  it('throws while the base-currency lock is set, as its REST route does, without scanning', async () => {
    lockCheck.mockResolvedValue(true);

    await expect(call({ tool, args: RANGE })).rejects.toThrow(LOCKED);

    expect(bulkScan).not.toHaveBeenCalled();
  });

  it('needs no scope: a read-only user may scan', async () => {
    bulkScan.mockResolvedValue({ total: 0, items: [] });

    await call({ tool, args: RANGE, extra: READ });

    expect(bulkScan).toHaveBeenCalled();
  });
});

describe('dismiss_transfer_suggestion', () => {
  const tool = captureTools({ register: registerDismissTransferSuggestion })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('declares the same fields as the REST body schema', () => {
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(Object.keys(dismissBodySchema.shape).toSorted());
  });

  it('accepts two ids and refuses a missing or malformed one', () => {
    expect(schema.safeParse({ expenseTransactionId: ID_1, incomeTransactionId: ID_2 }).success).toBe(true);
    expect(schema.safeParse({ expenseTransactionId: ID_1 }).success).toBe(false);
    expect(schema.safeParse({ expenseTransactionId: ID_1, incomeTransactionId: 'nope' }).success).toBe(false);
  });

  it('dismisses the pair for the caller', async () => {
    dismiss.mockResolvedValue(undefined);

    const data = await call({
      tool,
      args: { expenseTransactionId: ID_1, incomeTransactionId: ID_2 },
      extra: WRITE,
    });

    expect(dismiss).toHaveBeenCalledWith({ userId: 42, expenseTransactionId: ID_1, incomeTransactionId: ID_2 });
    expect(data).toEqual({ dismissed: true, expenseTransactionId: ID_1, incomeTransactionId: ID_2 });
  });

  it('passes the ownership refusal of the service through with its message', async () => {
    dismiss.mockRejectedValue(new ValidationError({ message: 'One or both transactions not found' }));

    await expect(
      call({ tool, args: { expenseTransactionId: ID_1, incomeTransactionId: ID_2 }, extra: WRITE }),
    ).rejects.toThrow('One or both transactions not found');
  });

  it('needs finance:write, an editing plan and an unlocked base currency, with nothing dismissed otherwise', async () => {
    const args = { expenseTransactionId: ID_1, incomeTransactionId: ID_2 };

    await expect(call({ tool, args, extra: READ })).rejects.toThrow(/no longer includes editing|finance:write/);
    await expect(call({ tool, args, extra: makeExtra({ scopes: ['finance:read'] }) })).rejects.toThrow(/finance:write/);
    await expect(
      call({ tool, args, extra: makeExtra({ scopes: ['finance:read', 'finance:write'], readOnly: true }) }),
    ).rejects.toThrow(/no longer includes editing/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);

    expect(dismiss).not.toHaveBeenCalled();
  });
});
