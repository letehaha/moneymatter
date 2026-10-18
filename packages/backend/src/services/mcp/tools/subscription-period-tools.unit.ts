import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import {
  acceptCandidateBodySchema,
  getPeriodsQuerySchema,
  markPeriodPaidBodySchema,
} from '@controllers/subscriptions/shared-schemas';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getPayeeNames } from '@services/payees/get-payee-names';
import { getSubscriptionPayPreview } from '@services/subscriptions/get-pay-preview';
import { getPeriods } from '@services/subscriptions/get-periods';
import { markPeriodPaid } from '@services/subscriptions/mark-period-paid';
import { resolveCandidate } from '@services/subscriptions/resolve-candidate';
import { revertPeriod } from '@services/subscriptions/revert-period';
import { skipPeriod } from '@services/subscriptions/skip-period';
import { suggestHistoricalMatches } from '@services/subscriptions/suggest-historical-matches';
import { unlinkTransaction } from '@services/subscriptions/unlink-transaction';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/subscriptions/resolve-candidate', () => ({ resolveCandidate: jest.fn() }));
jest.mock('@services/subscriptions/suggest-historical-matches', () => ({ suggestHistoricalMatches: jest.fn() }));
jest.mock('@services/subscriptions/get-periods', () => ({ getPeriods: jest.fn() }));
jest.mock('@services/subscriptions/get-pay-preview', () => ({ getSubscriptionPayPreview: jest.fn() }));
jest.mock('@services/subscriptions/mark-period-paid', () => ({ markPeriodPaid: jest.fn() }));
jest.mock('@services/subscriptions/skip-period', () => ({ skipPeriod: jest.fn() }));
jest.mock('@services/subscriptions/unlink-transaction', () => ({ unlinkTransaction: jest.fn() }));
jest.mock('@services/subscriptions/revert-period', () => ({ revertPeriod: jest.fn() }));
jest.mock('@services/payees/get-payee-names', () => ({ getPayeeNames: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerAcceptSubscriptionCandidate } from './accept-subscription-candidate';
import { registerGetSubscriptionPeriods } from './get-subscription-periods';
import { registerListSubscriptionMatchSuggestions } from './list-subscription-match-suggestions';
import { registerPaySubscriptionPeriod } from './pay-subscription-period';
import { registerPreviewSubscriptionPayment } from './preview-subscription-payment';
import { registerRevertSubscriptionPeriod } from './revert-subscription-period';
import { registerSkipSubscriptionPeriod } from './skip-subscription-period';
import { registerUnlinkSubscriptionPeriodTransaction } from './unlink-subscription-period-transaction';

const READ_ONLY = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const WRITE_DELETE = makeExtra({ scopes: ['finance:read', 'finance:write', 'finance:delete'] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const payeeNames = jest.mocked(getPayeeNames);
const resolve = jest.mocked(resolveCandidate);
const suggest = jest.mocked(suggestHistoricalMatches);
const periods = jest.mocked(getPeriods);
const preview = jest.mocked(getSubscriptionPayPreview);
const pay = jest.mocked(markPeriodPaid);
const skip = jest.mocked(skipPeriod);
const unlink = jest.mocked(unlinkTransaction);
const revert = jest.mocked(revertPeriod);

const SUB_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD_ID = '22222222-2222-4222-8222-222222222222';
const TX_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const CANDIDATE_ID = '55555555-5555-4555-8555-555555555555';
const PAYEE_ID = '66666666-6666-4666-8666-666666666666';

const call = async ({
  tool,
  args,
  extra = READ_ONLY,
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

describe('accept_subscription_candidate', () => {
  const tool = captureTools({ register: registerAcceptSubscriptionCandidate })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name', () => {
    expect(tool.name).toBe('accept_subscription_candidate');
  });

  it('declares the candidate id plus the fields of the REST body schema', () => {
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      ['candidateId', ...Object.keys(acceptCandidateBodySchema.shape)].toSorted(),
    );
    expect(schema.safeParse({ candidateId: CANDIDATE_ID }).success).toBe(true);
    expect(schema.safeParse({ candidateId: CANDIDATE_ID, subscriptionId: SUB_ID }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ candidateId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ candidateId: CANDIDATE_ID, subscriptionId: 'nope' }).success).toBe(false);
  });

  it('accepts the candidate, attaching it to the subscription when one is named', async () => {
    resolve.mockResolvedValue({ id: CANDIDATE_ID, status: 'accepted' } as never);

    const data = await call({ tool, args: { candidateId: CANDIDATE_ID, subscriptionId: SUB_ID }, extra: WRITE });

    expect(resolve).toHaveBeenCalledWith({ userId: 42, candidateId: CANDIDATE_ID, subscriptionId: SUB_ID });
    expect(data).toEqual({ id: CANDIDATE_ID, status: 'accepted' });
  });

  it('passes no subscription when none is named', async () => {
    resolve.mockResolvedValue({ id: CANDIDATE_ID, status: 'accepted' } as never);

    await call({ tool, args: { candidateId: CANDIDATE_ID }, extra: WRITE });

    expect(resolve).toHaveBeenCalledWith({ userId: 42, candidateId: CANDIDATE_ID, subscriptionId: undefined });
  });

  it('needs finance:write and an unlocked base currency, and refuses a read-only user', async () => {
    await expect(call({ tool, args: { candidateId: CANDIDATE_ID }, extra: NO_WRITE_SCOPE })).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(call({ tool, args: { candidateId: CANDIDATE_ID }, extra: READ_ONLY })).rejects.toThrow(
      /no longer includes editing/,
    );

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: { candidateId: CANDIDATE_ID }, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('list_subscription_match_suggestions', () => {
  const tool = captureTools({ register: registerListSubscriptionMatchSuggestions })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  const makeTx = (patch: Record<string, unknown> = {}) => ({
    id: TX_ID,
    userId: 42,
    time: '2026-10-01T10:00:00.000Z',
    amount: 9.99,
    refAmount: 9.99,
    currencyCode: 'USD',
    note: 'netflix',
    transactionType: TRANSACTION_TYPES.expense,
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    transferId: null,
    accountId: ACCOUNT_ID,
    categoryId: null,
    isPlanned: false,
    payeeId: null,
    ...patch,
  });

  it('registers under its name and takes the subscription id', () => {
    expect(tool.name).toBe('list_subscription_match_suggestions');
    expect(schema.safeParse({ subscriptionId: SUB_ID }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('returns slim transactions with their payee and a count', async () => {
    suggest.mockResolvedValue([makeTx({ payeeId: PAYEE_ID })] as never);
    payeeNames.mockResolvedValue(new Map([[PAYEE_ID, 'Netflix']]));

    const data = (await call({ tool, args: { subscriptionId: SUB_ID } })) as {
      suggestions: Record<string, unknown>[];
      total: number;
    };

    expect(suggest).toHaveBeenCalledWith({ subscriptionId: SUB_ID, userId: 42 });
    expect(data.total).toBe(1);
    expect(data.suggestions[0]).toMatchObject({ id: TX_ID, payee: { id: PAYEE_ID, name: 'Netflix' } });
    expect(data.suggestions[0]).not.toHaveProperty('userId');
  });

  it('returns an empty list when the subscription has no matching rules', async () => {
    suggest.mockResolvedValue([]);

    expect(await call({ tool, args: { subscriptionId: SUB_ID } })).toEqual({ suggestions: [], total: 0 });
  });

  it('is a read tool: a read-only user may call it and no lock is checked', async () => {
    suggest.mockResolvedValue([]);
    lockCheck.mockResolvedValue(true);

    await call({ tool, args: { subscriptionId: SUB_ID }, extra: READ_ONLY });

    expect(lockCheck).not.toHaveBeenCalled();
    expect(suggest).toHaveBeenCalled();
  });
});

describe('get_subscription_periods', () => {
  const tool = captureTools({ register: registerGetSubscriptionPeriods })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name and declares the id plus the fields of the REST query schema', () => {
    expect(tool.name).toBe('get_subscription_periods');
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      ['subscriptionId', ...Object.keys(getPeriodsQuerySchema.shape)].toSorted(),
    );
  });

  it('takes a page of 1 to 50 and a non-negative offset', () => {
    expect(schema.safeParse({ subscriptionId: SUB_ID }).success).toBe(true);
    expect(schema.safeParse({ subscriptionId: SUB_ID, limit: 50, offset: 0 }).success).toBe(true);
    expect(schema.safeParse({ subscriptionId: SUB_ID, limit: 51 }).success).toBe(false);
    expect(schema.safeParse({ subscriptionId: SUB_ID, limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ subscriptionId: SUB_ID, offset: -1 }).success).toBe(false);
    expect(schema.safeParse({ subscriptionId: SUB_ID, limit: 1.5 }).success).toBe(false);
  });

  it('passes the page through and returns the periods with the total', async () => {
    periods.mockResolvedValue({ periods: [{ id: PERIOD_ID, status: 'paid' }], total: 7 } as never);

    const data = await call({ tool, args: { subscriptionId: SUB_ID, limit: 2, offset: 4 } });

    expect(periods).toHaveBeenCalledWith({ userId: 42, subscriptionId: SUB_ID, limit: 2, offset: 4 });
    expect(data).toEqual({ periods: [{ id: PERIOD_ID, status: 'paid' }], total: 7 });
  });

  it('leaves the page to the service default when none is given', async () => {
    periods.mockResolvedValue({ periods: [], total: 0 } as never);

    await call({ tool, args: { subscriptionId: SUB_ID } });

    expect(periods).toHaveBeenCalledWith({ userId: 42, subscriptionId: SUB_ID, limit: undefined, offset: undefined });
  });

  it('is a read tool: a read-only user may call it and no lock is checked', async () => {
    periods.mockResolvedValue({ periods: [], total: 0 } as never);
    lockCheck.mockResolvedValue(true);

    await call({ tool, args: { subscriptionId: SUB_ID }, extra: READ_ONLY });

    expect(lockCheck).not.toHaveBeenCalled();
  });
});

describe('preview_subscription_payment', () => {
  const tool = captureTools({ register: registerPreviewSubscriptionPayment })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  it('registers under its name; the period is optional', () => {
    expect(tool.name).toBe('preview_subscription_payment');
    expect(schema.safeParse({ subscriptionId: SUB_ID }).success).toBe(true);
    expect(schema.safeParse({ subscriptionId: SUB_ID, periodId: PERIOD_ID }).success).toBe(true);
    expect(schema.safeParse({ periodId: PERIOD_ID }).success).toBe(false);
  });

  it('returns the preview of the period, and is open to a read-only user without a lock check', async () => {
    const result = { isCrossCurrency: false, expectedAmount: 20, convertedAmount: null, linkedPayments: [] };
    preview.mockResolvedValue(result as never);
    lockCheck.mockResolvedValue(true);

    const data = await call({ tool, args: { subscriptionId: SUB_ID, periodId: PERIOD_ID }, extra: READ_ONLY });

    expect(preview).toHaveBeenCalledWith({ userId: 42, subscriptionId: SUB_ID, periodId: PERIOD_ID });
    expect(data).toEqual(result);
    expect(lockCheck).not.toHaveBeenCalled();
  });
});

describe('pay_subscription_period', () => {
  const tool = captureTools({ register: registerPaySubscriptionPeriod })[0]!;
  const schema = z.object(tool.config.inputSchema!);
  const base = { subscriptionId: SUB_ID, periodId: PERIOD_ID };

  it('registers under its name and declares the ids plus the fields of the REST body schema', () => {
    expect(tool.name).toBe('pay_subscription_period');
    expect(Object.keys(tool.config.inputSchema!).toSorted()).toEqual(
      ['subscriptionId', 'periodId', ...Object.keys(markPeriodPaidBodySchema.shape)].toSorted(),
    );
    expect(tool.config.description).toMatch(/createTransaction/);
  });

  it('links an existing transaction', async () => {
    pay.mockResolvedValue({ id: PERIOD_ID, status: 'paid' } as never);

    const data = await call({ tool, args: { ...base, transactionId: TX_ID, notes: 'march' }, extra: WRITE });

    expect(pay).toHaveBeenCalledWith({
      userId: 42,
      subscriptionId: SUB_ID,
      periodId: PERIOD_ID,
      transactionId: TX_ID,
      notes: 'march',
      createTransaction: undefined,
      amount: undefined,
      time: undefined,
      accountId: undefined,
    });
    expect(data).toEqual({ id: PERIOD_ID, status: 'paid' });
  });

  it('creates the transaction with an amount, a payment date and an account, handing the service a Date', async () => {
    pay.mockResolvedValue({ id: PERIOD_ID, status: 'paid' } as never);

    await call({
      tool,
      args: {
        ...base,
        createTransaction: true,
        amount: 12.5,
        time: '2026-10-05T08:00:00.000Z',
        accountId: ACCOUNT_ID,
      },
      extra: WRITE,
    });

    expect(pay).toHaveBeenCalledWith(
      expect.objectContaining({
        createTransaction: true,
        amount: 12.5,
        time: new Date('2026-10-05T08:00:00.000Z'),
        accountId: ACCOUNT_ID,
        transactionId: undefined,
      }),
    );
  });

  it('pays with neither a link nor a creation when the period is only being marked paid', async () => {
    pay.mockResolvedValue({ id: PERIOD_ID, status: 'paid' } as never);

    await call({ tool, args: base, extra: WRITE });

    expect(pay).toHaveBeenCalledTimes(1);
  });

  it('refuses a link and a creation together, as REST does, with the service not called', async () => {
    await expect(
      call({ tool, args: { ...base, createTransaction: true, transactionId: TX_ID }, extra: WRITE }),
    ).rejects.toThrow(/cannot be used together/);
    expect(pay).not.toHaveBeenCalled();
  });

  it('allows createTransaction false with a transaction to link', async () => {
    pay.mockResolvedValue({ id: PERIOD_ID } as never);

    await call({ tool, args: { ...base, createTransaction: false, transactionId: TX_ID }, extra: WRITE });

    expect(pay).toHaveBeenCalledWith(expect.objectContaining({ transactionId: TX_ID, createTransaction: false }));
  });

  it('refuses a non-positive amount, a malformed date and a note past 5000 characters', async () => {
    for (const patch of [{ amount: 0 }, { amount: -5 }, { time: 'yesterday' }, { notes: 'x'.repeat(5001) }]) {
      await expect(
        call({ tool, args: { ...base, createTransaction: true, ...patch }, extra: WRITE }),
      ).rejects.toThrow();
    }
    expect(pay).not.toHaveBeenCalled();
  });

  it('refuses a malformed id at the schema', () => {
    expect(schema.safeParse({ ...base, periodId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ subscriptionId: SUB_ID }).success).toBe(false);
  });

  it('needs finance:write and an unlocked base currency, and refuses a read-only user', async () => {
    await expect(call({ tool, args: base, extra: NO_WRITE_SCOPE })).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(call({ tool, args: base, extra: READ_ONLY })).rejects.toThrow(/no longer includes editing/);

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: base, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(pay).not.toHaveBeenCalled();
  });
});

describe.each([
  { name: 'skip_subscription_period', register: registerSkipSubscriptionPeriod, service: skip },
  {
    name: 'unlink_subscription_period_transaction',
    register: registerUnlinkSubscriptionPeriodTransaction,
    service: unlink,
  },
])('$name', ({ name, register, service }) => {
  const tool = captureTools({ register })[0]!;
  const schema = z.object(tool.config.inputSchema!);
  const args = { subscriptionId: SUB_ID, periodId: PERIOD_ID };

  it('registers under its name and takes both ids', () => {
    expect(tool.name).toBe(name);
    expect(schema.safeParse(args).success).toBe(true);
    expect(schema.safeParse({ subscriptionId: SUB_ID }).success).toBe(false);
    expect(schema.safeParse({ periodId: PERIOD_ID }).success).toBe(false);
  });

  it('calls the service for the period and returns it', async () => {
    jest.mocked(service).mockResolvedValue({ id: PERIOD_ID } as never);

    expect(await call({ tool, args, extra: WRITE })).toEqual({ id: PERIOD_ID });
    expect(service).toHaveBeenCalledWith({ userId: 42, subscriptionId: SUB_ID, periodId: PERIOD_ID });
  });

  it('needs finance:write and an unlocked base currency, and refuses a read-only user', async () => {
    await expect(call({ tool, args, extra: READ_ONLY })).rejects.toThrow(/no longer includes editing/);
    await expect(call({ tool, args, extra: makeExtra({ scopes: ['finance:read'], readOnly: false }) })).rejects.toThrow(
      /Missing required scope: finance:write/,
    );

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(service).not.toHaveBeenCalled();
  });
});

describe('revert_subscription_period', () => {
  const tool = captureTools({ register: registerRevertSubscriptionPeriod })[0]!;
  const schema = z.object(tool.config.inputSchema!);
  const args = { subscriptionId: SUB_ID, periodId: PERIOD_ID };
  const WRITE_ONLY = makeExtra({ scopes: ['finance:read', 'finance:write'] });

  type RevertParams = NonNullable<Parameters<typeof revertPeriod>[0]>;

  /** A service that keeps the payment transaction: it never reaches the delete branch. */
  const serviceKeepsTransaction = () =>
    revert.mockImplementation((async () => ({ id: PERIOD_ID, status: 'upcoming' })) as never);

  /** A service that reaches the delete branch: it asks the callback first, as the real one does. */
  const serviceDeletesTransaction = () => {
    const deleted = jest.fn();
    revert.mockImplementation((async ({ assertCanDeleteTransaction }: RevertParams) => {
      assertCanDeleteTransaction?.();
      deleted();
      return { id: PERIOD_ID, status: 'upcoming' };
    }) as never);
    return deleted;
  };

  it('registers under its name, takes both ids and warns that the transaction can be deleted', () => {
    expect(tool.name).toBe('revert_subscription_period');
    expect(schema.safeParse(args).success).toBe(true);
    expect(schema.safeParse({ subscriptionId: SUB_ID }).success).toBe(false);
    expect(tool.config.description).toMatch(/delete/i);
    expect(tool.config.description).toMatch(/finance:delete/);
  });

  it('hands the service a callback and no preliminary decision about the transaction', async () => {
    serviceKeepsTransaction();

    await call({ tool, args, extra: WRITE_ONLY });

    expect(revert).toHaveBeenCalledWith({
      userId: 42,
      subscriptionId: SUB_ID,
      periodId: PERIOD_ID,
      assertCanDeleteTransaction: expect.any(Function),
    });
  });

  it('passes a write-only token when the service never asks to delete', async () => {
    serviceKeepsTransaction();

    expect(await call({ tool, args, extra: WRITE_ONLY })).toEqual({ id: PERIOD_ID, status: 'upcoming' });
  });

  it('refuses a write-only token when the service asks to delete, so the delete never happens', async () => {
    const deleted = serviceDeletesTransaction();

    await expect(call({ tool, args, extra: WRITE_ONLY })).rejects.toThrow(/Missing required scope: finance:delete/);
    expect(deleted).not.toHaveBeenCalled();
  });

  it('passes a token with finance:delete both when the service asks to delete and when it does not', async () => {
    const deleted = serviceDeletesTransaction();
    expect(await call({ tool, args, extra: WRITE_DELETE })).toEqual({ id: PERIOD_ID, status: 'upcoming' });
    expect(deleted).toHaveBeenCalledTimes(1);

    serviceKeepsTransaction();
    expect(await call({ tool, args, extra: WRITE_DELETE })).toEqual({ id: PERIOD_ID, status: 'upcoming' });
  });

  it('refuses a token with finance:delete but not finance:write, before the service runs', async () => {
    await expect(
      call({ tool, args, extra: makeExtra({ scopes: ['finance:read', 'finance:delete'] }) }),
    ).rejects.toThrow(/Missing required scope: finance:write/);
    expect(revert).not.toHaveBeenCalled();
  });

  it('refuses a read-only user and a locked base currency before the service runs', async () => {
    await expect(call({ tool, args, extra: READ_ONLY })).rejects.toThrow(/no longer includes editing/);

    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE_DELETE })).rejects.toThrow(LOCKED);
    expect(revert).not.toHaveBeenCalled();
  });
});
