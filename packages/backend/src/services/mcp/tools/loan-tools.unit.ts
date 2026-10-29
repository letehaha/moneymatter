import { LOAN_TYPE, type LoanApiResponse } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError, ValidationError } from '@js/errors';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { createLoan } from '@services/loans/create-loan.service';
import { deleteLoan } from '@services/loans/delete-loan.service';
import { getLoanBalanceHistory } from '@services/loans/get-loan-balance-history.service';
import { getLoanView, getLoanViews, toLoanView } from '@services/loans/get-loan-views.service';
import { linkLoanPayments } from '@services/loans/link-loan-payments.service';
import { unlinkLoanPayment } from '@services/loans/unlink-loan-payment.service';
import { updateLoan } from '@services/loans/update-loan.service';
import {
  createLoanBodyFields,
  linkLoanPaymentsBodySchema,
  loanNoteEventSchema,
  unlinkLoanPaymentBodySchema,
  updateLoanBodyFields,
} from '@services/loans/zod-schemas';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/loans/create-loan.service', () => ({ createLoan: jest.fn() }));
jest.mock('@services/loans/update-loan.service', () => ({ updateLoan: jest.fn() }));
jest.mock('@services/loans/delete-loan.service', () => ({ deleteLoan: jest.fn() }));
jest.mock('@services/loans/link-loan-payments.service', () => ({ linkLoanPayments: jest.fn() }));
jest.mock('@services/loans/unlink-loan-payment.service', () => ({ unlinkLoanPayment: jest.fn() }));
jest.mock('@services/loans/get-loan-balance-history.service', () => ({ getLoanBalanceHistory: jest.fn() }));
jest.mock('@services/loans/get-loan-views.service', () => ({
  getLoanView: jest.fn(),
  getLoanViews: jest.fn(),
  toLoanView: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { registerAddLoanNote } from './add-loan-note';
import { registerCreateLoan } from './create-loan';
import { registerDeleteLoan } from './delete-loan';
import { registerGetLoanBalanceHistory } from './get-loan-balance-history';
import { registerGetLoans } from './get-loans';
import { registerLinkLoanPayments } from './link-loan-payments';
import { registerUnlinkLoanPayment } from './unlink-loan-payment';
import { registerUpdateLoan } from './update-loan';

const READ_ONLY = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE_ONLY = makeExtra({ scopes: ['finance:read', 'finance:delete'] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });
const READ_ONLY_USER_WITH_SCOPES = makeExtra({ readOnly: true });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const createLoanService = jest.mocked(createLoan);
const updateLoanService = jest.mocked(updateLoan);
const deleteLoanService = jest.mocked(deleteLoan);
const linkService = jest.mocked(linkLoanPayments);
const unlinkService = jest.mocked(unlinkLoanPayment);
const balanceHistory = jest.mocked(getLoanBalanceHistory);
const loanView = jest.mocked(getLoanView);
const loanViews = jest.mocked(getLoanViews);
const assembleView = jest.mocked(toLoanView);

const LOAN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_LOAN_ID = '22222222-2222-4222-8222-222222222222';
const TX_ID = '33333333-3333-4333-8333-333333333333';
const TX_ID_2 = '44444444-4444-4444-8444-444444444444';

const call = async ({
  tool,
  args,
  extra = READ_ONLY,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

/** A loan as the REST serializer returns it, including the fields an assistant has no use for. */
const makeLoanView = (patch: Record<string, unknown> = {}) =>
  ({
    id: LOAN_ID,
    name: 'Mortgage',
    initialBalance: -200_000,
    refInitialBalance: -200_000,
    currentBalance: -190_000.5,
    refCurrentBalance: -190_000.5,
    creditLimit: 0,
    refCreditLimit: 0,
    type: 'system',
    accountCategory: 'loan',
    currencyCode: 'USD',
    userId: 42,
    externalId: null,
    status: 'active',
    excludeFromStats: false,
    bankDataProviderConnectionId: null,
    bankProviderType: null,
    logoDomain: null,
    logoInitials: null,
    logoColor: null,
    loanDetails: {
      id: '55555555-5555-4555-8555-555555555555',
      loanType: LOAN_TYPE.mortgage,
      originalPrincipal: 200_000,
      refOriginalPrincipal: 200_000,
      interestRate: 6,
      termMonths: 360,
      startDate: '2020-06-15',
      balanceAnchorDate: '2020-06-15',
      minPayment: 1_100,
      refMinPayment: 1_100,
      plannedPayment: 1_200,
      refPlannedPayment: 1_200,
      paymentDayOfMonth: 15,
      lenderName: 'Chase',
      accountNumber: '4521',
      events: [{ type: 'note', at: '2026-10-01T10:00:00.000Z', text: 'Rate fixed' }],
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-02T10:00:00.000Z',
    },
    projection: {
      isPaidOff: false,
      warning: null,
      payoffDate: '2050-06-15',
      monthsRemaining: 290,
      totalInterestRemaining: 150_000,
      estimatedInterestPaid: 20_000,
      monthlyPrincipal: 200,
      paidToDate: 9_999.5,
      paidToDatePercent: 5,
      monthlyInterest: 950,
    },
    paymentsCount: 3,
    ...patch,
  }) as unknown as LoanApiResponse;

/** What an assistant sees of a loan: the account and detail fields it can act on, no owner or bank fields. */
const presentedLoan = (patch: Record<string, unknown> = {}) => ({
  id: LOAN_ID,
  name: 'Mortgage',
  currencyCode: 'USD',
  status: 'active',
  excludeFromStats: false,
  currentBalance: -190_000.5,
  refCurrentBalance: -190_000.5,
  loanDetails: {
    loanType: LOAN_TYPE.mortgage,
    originalPrincipal: 200_000,
    interestRate: 6,
    termMonths: 360,
    startDate: '2020-06-15',
    balanceAnchorDate: '2020-06-15',
    minPayment: 1_100,
    plannedPayment: 1_200,
    paymentDayOfMonth: 15,
    lenderName: 'Chase',
    accountNumber: '4521',
    events: [{ type: 'note', at: '2026-10-01T10:00:00.000Z', text: 'Rate fixed' }],
  },
  projection: makeLoanView().projection,
  paymentsCount: 3,
  ...patch,
});

const makeLoanDetails = () => ({ id: 'details-1', accountId: LOAN_ID, account: { id: LOAN_ID } });

const VALID_CREATE = {
  name: 'Car loan',
  currencyCode: 'USD',
  initialBalance: 15_000.55,
  loanType: LOAN_TYPE.auto,
  originalPrincipal: 20_000,
  interestRate: 4.5,
  startDate: '2024-01-15',
};

const series = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    date: `2020-01-${String(index + 1).padStart(2, '0')}`,
    amount: 0 - index,
  }));

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('get_loans', () => {
  const tool = captureTools({ register: registerGetLoans })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and takes only an optional loan id', () => {
    expect(tool.name).toBe('get_loans');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['loanId']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ loanId: LOAN_ID }).success).toBe(true);
    expect(schema.safeParse({ loanId: 'nope' }).success).toBe(false);
  });

  it('lists the loans of the caller slimmed, without the timeline, and works for a read-only user during a base-currency change', async () => {
    lockCheck.mockResolvedValue(true);
    loanViews.mockResolvedValue([makeLoanView(), makeLoanView({ id: OTHER_LOAN_ID, name: 'Car' })]);

    const data = (await call({ tool, args: {}, extra: READ_ONLY })) as Record<string, unknown>[];

    expect(loanViews).toHaveBeenCalledWith({ userId: 42 });
    expect(loanView).not.toHaveBeenCalled();
    expect(data).toHaveLength(2);
    const expectedLoanDetails = { ...presentedLoan().loanDetails } as Record<string, unknown>;
    delete expectedLoanDetails.events;
    expect(data[0]).toEqual(presentedLoan({ loanDetails: expectedLoanDetails }));
    expect(data[1]).toMatchObject({ id: OTHER_LOAN_ID, name: 'Car' });
  });

  it('returns an empty list for a user without loans', async () => {
    loanViews.mockResolvedValue([]);

    expect(await call({ tool, args: {} })).toEqual([]);
  });

  it('reads one loan with its timeline for the caller', async () => {
    loanView.mockResolvedValue(makeLoanView());

    const data = await call({ tool, args: { loanId: LOAN_ID } });

    expect(loanView).toHaveBeenCalledWith({ userId: 42, accountId: LOAN_ID });
    expect(loanViews).not.toHaveBeenCalled();
    expect(data).toEqual(presentedLoan());
  });

  it('leaves out the owner, bank and logo fields of the account', async () => {
    loanView.mockResolvedValue(makeLoanView());

    const data = (await call({ tool, args: { loanId: LOAN_ID } })) as Record<string, unknown>;

    for (const key of ['userId', 'externalId', 'bankDataProviderConnectionId', 'logoDomain', 'creditLimit', 'type']) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it("passes another user's loan through as the service not-found error", async () => {
    loanView.mockRejectedValue(new NotFoundError({ message: 'Loan not found' }));

    await expect(call({ tool, args: { loanId: OTHER_LOAN_ID } })).rejects.toThrow('Loan not found');
  });

  it('says that debt is negative and where the payoff figures come from', () => {
    expect(tool.config.description).toMatch(/negative/);
    expect(tool.config.description).toMatch(/projection/);
  });
});

describe('get_loan_balance_history', () => {
  const tool = captureTools({ register: registerGetLoanBalanceHistory })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name, requires a loan id and bounds the limit', () => {
    expect(tool.name).toBe('get_loan_balance_history');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['limit', 'loanId']);
    expect(schema.safeParse({ loanId: LOAN_ID }).success).toBe(true);
    expect(schema.safeParse({ loanId: LOAN_ID, limit: 500 }).success).toBe(true);
    expect(schema.safeParse({ loanId: LOAN_ID, limit: 501 }).success).toBe(false);
    expect(schema.safeParse({ loanId: LOAN_ID, limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ loanId: LOAN_ID, limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('returns the whole series with its total when it is shorter than the default limit', async () => {
    balanceHistory.mockResolvedValue(series(3));

    const data = await call({ tool, args: { loanId: LOAN_ID } });

    expect(balanceHistory).toHaveBeenCalledWith({ userId: 42, accountId: LOAN_ID });
    expect(data).toEqual({ total: 3, points: series(3) });
  });

  it('keeps the newest points, in date order, when the series is longer than the limit', async () => {
    balanceHistory.mockResolvedValue(series(10));

    const data = await call({ tool, args: { loanId: LOAN_ID, limit: 4 } });

    expect(data).toEqual({ total: 10, points: series(10).slice(6) });
  });

  it('defaults to 120 points', async () => {
    const long = Array.from({ length: 200 }, (_, index) => ({ date: `d${index}`, amount: 0 - index }));
    balanceHistory.mockResolvedValue(long);

    const data = (await call({ tool, args: { loanId: LOAN_ID } })) as { total: number; points: unknown[] };

    expect(data.total).toBe(200);
    expect(data.points).toHaveLength(120);
    expect(data.points[0]).toEqual(long[80]);
  });

  it("passes another user's loan through as the service not-found error", async () => {
    balanceHistory.mockRejectedValue(new NotFoundError({ message: 'Loan not found' }));

    await expect(call({ tool, args: { loanId: OTHER_LOAN_ID } })).rejects.toThrow('Loan not found');
  });

  it('works for a read-only user during a base-currency change', async () => {
    lockCheck.mockResolvedValue(true);
    balanceHistory.mockResolvedValue([]);

    expect(await call({ tool, args: { loanId: LOAN_ID }, extra: READ_ONLY })).toEqual({ total: 0, points: [] });
  });
});

describe('create_loan', () => {
  const tool = captureTools({ register: registerCreateLoan })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with every field of the REST body', () => {
    expect(tool.name).toBe('create_loan');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(Object.keys(createLoanBodyFields).toSorted());
  });

  it('applies the REST validation', () => {
    expect(schema.safeParse(VALID_CREATE).success).toBe(true);
    expect(schema.safeParse({ ...VALID_CREATE, minPayment: 100, plannedPayment: null, termMonths: 48 }).success).toBe(
      true,
    );

    const invalid: Record<string, unknown>[] = [
      { originalPrincipal: undefined },
      { name: '' },
      { currencyCode: 'usd1' },
      { initialBalance: -1 },
      { originalPrincipal: 0 },
      { interestRate: -1 },
      { interestRate: 100 },
      { termMonths: 0 },
      { termMonths: 1201 },
      { paymentDayOfMonth: 32 },
      { startDate: '2024-02-30' },
      { startDate: '2099-01-01' },
      { loanType: LOAN_TYPE.heloc },
      { minPayment: -1 },
      { plannedPayment: -1 },
    ];
    for (const patch of invalid) {
      expect([patch, schema.safeParse({ ...VALID_CREATE, ...patch }).success]).toEqual([patch, false]);
    }
  });

  it('creates the loan for the caller with the amounts as Money and returns it slimmed', async () => {
    const details = makeLoanDetails();
    createLoanService.mockResolvedValue(details as never);
    assembleView.mockResolvedValue(makeLoanView({ paymentsCount: 0 }));

    const data = await call({
      tool,
      args: { ...VALID_CREATE, minPayment: 250.25, plannedPayment: 300, lenderName: 'Bank' },
      extra: WRITE,
    });

    expect(createLoanService).toHaveBeenCalledTimes(1);
    const params = createLoanService.mock.calls[0]![0];
    expect(params).toMatchObject({
      userId: 42,
      name: 'Car loan',
      currencyCode: 'USD',
      loanType: LOAN_TYPE.auto,
      interestRate: 4.5,
      startDate: '2024-01-15',
      lenderName: 'Bank',
    });
    expect(params.initialBalance).toBeInstanceOf(Money);
    expect(params.initialBalance.toNumber()).toBe(15_000.55);
    expect(params.originalPrincipal).toBeInstanceOf(Money);
    expect(params.originalPrincipal.toNumber()).toBe(20_000);
    expect(params.minPayment).toBeInstanceOf(Money);
    expect(params.minPayment?.toNumber()).toBe(250.25);
    expect(params.plannedPayment?.toNumber()).toBe(300);
    expect(assembleView).toHaveBeenCalledWith({ userId: 42, loanDetails: details, paymentsCount: 0 });
    expect(data).toEqual(presentedLoan({ paymentsCount: 0 }));
  });

  it('keeps an omitted or cleared payment amount null-ish rather than zero', async () => {
    createLoanService.mockResolvedValue(makeLoanDetails() as never);
    assembleView.mockResolvedValue(makeLoanView());

    await call({ tool, args: { ...VALID_CREATE, plannedPayment: null }, extra: WRITE });

    const params = createLoanService.mock.calls[0]![0];
    expect(params.plannedPayment).toBeNull();
    expect(params.minPayment).toBeUndefined();
  });

  it('lets a service error through, such as a currency the user cannot use', async () => {
    createLoanService.mockRejectedValue(new ValidationError({ message: 'Currency is not available' }));

    await expect(call({ tool, args: VALID_CREATE, extra: WRITE })).rejects.toThrow('Currency is not available');
  });

  it('rejects an invalid payload in the handler too, before the service', async () => {
    await expect(call({ tool, args: { ...VALID_CREATE, originalPrincipal: 0 }, extra: WRITE })).rejects.toThrow();
    expect(createLoanService).not.toHaveBeenCalled();
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    await expect(call({ tool, args: VALID_CREATE, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args: VALID_CREATE, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: VALID_CREATE, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(createLoanService).not.toHaveBeenCalled();
  });
});

describe('update_loan', () => {
  const tool = captureTools({ register: registerUpdateLoan })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the loan id and every field of the REST body', () => {
    expect(tool.name).toBe('update_loan');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['loanId', ...Object.keys(updateLoanBodyFields)].toSorted(),
    );
    expect(tool.config.description).toMatch(/currencyCode|currency/);
    expect(tool.config.description).toMatch(/currentBalanceAsOf/);
  });

  it('applies the REST field validation', () => {
    expect(schema.safeParse({ loanId: LOAN_ID, interestRate: 5 }).success).toBe(true);
    expect(schema.safeParse({ loanId: LOAN_ID, termMonths: null, plannedPayment: null }).success).toBe(true);

    const invalid: Record<string, unknown>[] = [
      { currentBalance: -50 },
      { interestRate: 100 },
      { startDate: '2024-02-30' },
      { startDate: '2099-01-01' },
      { currentBalance: 10, currentBalanceAsOf: '2099-01-01' },
      { minPayment: -1 },
      { plannedPayment: -1 },
      { paymentDayOfMonth: 0 },
      { name: '' },
    ];
    for (const patch of invalid) {
      expect([patch, schema.safeParse({ loanId: LOAN_ID, ...patch }).success]).toEqual([patch, false]);
    }
  });

  it('refuses an empty patch and an as-of date without a balance, as the REST body schema does, before the service', async () => {
    await expect(call({ tool, args: { loanId: LOAN_ID }, extra: WRITE })).rejects.toThrow(/At least one field/);
    await expect(
      call({ tool, args: { loanId: LOAN_ID, currentBalanceAsOf: '2026-10-01' }, extra: WRITE }),
    ).rejects.toThrow(/currentBalanceAsOf requires currentBalance/);
    expect(updateLoanService).not.toHaveBeenCalled();
  });

  it('updates the loan for the caller with the amounts as Money and returns it slimmed', async () => {
    const details = makeLoanDetails();
    updateLoanService.mockResolvedValue(details as never);
    assembleView.mockResolvedValue(makeLoanView());

    const data = await call({
      tool,
      args: { loanId: LOAN_ID, currentBalance: 150_000.25, currentBalanceAsOf: '2026-09-01', plannedPayment: null },
      extra: WRITE,
    });

    expect(updateLoanService).toHaveBeenCalledTimes(1);
    const params = updateLoanService.mock.calls[0]![0];
    expect(params).toMatchObject({ userId: 42, accountId: LOAN_ID, currentBalanceAsOf: '2026-09-01' });
    expect(params).not.toHaveProperty('loanId');
    expect(params.currentBalance).toBeInstanceOf(Money);
    expect(params.currentBalance?.toNumber()).toBe(150_000.25);
    expect(params.plannedPayment).toBeNull();
    expect(params.minPayment).toBeUndefined();
    expect(assembleView).toHaveBeenCalledWith({ userId: 42, loanDetails: details });
    expect(data).toEqual(presentedLoan());
  });

  it("passes another user's loan through as the service not-found error", async () => {
    updateLoanService.mockRejectedValue(new NotFoundError({ message: 'Loan not found' }));

    await expect(call({ tool, args: { loanId: OTHER_LOAN_ID, interestRate: 5 }, extra: WRITE })).rejects.toThrow(
      'Loan not found',
    );
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { loanId: LOAN_ID, interestRate: 5 };

    await expect(call({ tool, args, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(updateLoanService).not.toHaveBeenCalled();
  });
});

describe('delete_loan', () => {
  const tool = captureTools({ register: registerDeleteLoan })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name, takes a loan id and warns that it is irreversible and blocked by payments', () => {
    expect(tool.name).toBe('delete_loan');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['loanId']);
    expect(schema.safeParse({ loanId: LOAN_ID }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(tool.config.description).toMatch(/irreversible|permanent/i);
    expect(tool.config.description).toMatch(/payment/);
  });

  it('deletes the loan for the caller', async () => {
    deleteLoanService.mockResolvedValue(undefined as never);

    const data = await call({ tool, args: { loanId: LOAN_ID }, extra: DELETE_ONLY });

    expect(deleteLoanService).toHaveBeenCalledWith({ userId: 42, accountId: LOAN_ID });
    expect(data).toEqual({ deleted: true, id: LOAN_ID });
  });

  it('lets a service error through, such as a loan with recorded payments', async () => {
    deleteLoanService.mockRejectedValue(new ValidationError({ message: 'Loan has payments' }));

    await expect(call({ tool, args: { loanId: LOAN_ID }, extra: DELETE_ONLY })).rejects.toThrow('Loan has payments');
  });

  it('refuses a read-only user, a write-only scope and a base-currency change, before the service', async () => {
    const args = { loanId: LOAN_ID };

    await expect(call({ tool, args, extra: makeExtra({ readOnly: true }) })).rejects.toThrow();
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/finance:delete/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(LOCKED);
    expect(deleteLoanService).not.toHaveBeenCalled();
  });
});

describe('add_loan_note', () => {
  const tool = captureTools({ register: registerAddLoanNote })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the loan id and the REST note text', () => {
    expect(tool.name).toBe('add_loan_note');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['loanId', ...Object.keys(loanNoteEventSchema.shape)].toSorted(),
    );
  });

  it('accepts 1 to 2000 characters and trims, as REST does', () => {
    expect(schema.safeParse({ loanId: LOAN_ID, text: 'x' }).success).toBe(true);
    expect(schema.safeParse({ loanId: LOAN_ID, text: 'x'.repeat(2000) }).success).toBe(true);
    expect(schema.safeParse({ loanId: LOAN_ID, text: 'x'.repeat(2001) }).success).toBe(false);
    expect(schema.safeParse({ loanId: LOAN_ID, text: '   ' }).success).toBe(false);
    expect(schema.safeParse({ loanId: LOAN_ID, text: '' }).success).toBe(false);
    expect(schema.safeParse({ text: 'x' }).success).toBe(false);
  });

  it('appends the note for the caller and returns the loan slimmed', async () => {
    const details = makeLoanDetails();
    updateLoanService.mockResolvedValue(details as never);
    assembleView.mockResolvedValue(makeLoanView());

    const data = await call({ tool, args: { loanId: LOAN_ID, text: 'Rate fixed' }, extra: WRITE });

    expect(updateLoanService).toHaveBeenCalledWith({ userId: 42, accountId: LOAN_ID, appendNote: 'Rate fixed' });
    expect(assembleView).toHaveBeenCalledWith({ userId: 42, loanDetails: details });
    expect(data).toEqual(presentedLoan());
  });

  it("passes another user's loan through as the service not-found error", async () => {
    updateLoanService.mockRejectedValue(new NotFoundError({ message: 'Loan not found' }));

    await expect(call({ tool, args: { loanId: OTHER_LOAN_ID, text: 'x' }, extra: WRITE })).rejects.toThrow(
      'Loan not found',
    );
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { loanId: LOAN_ID, text: 'x' };

    await expect(call({ tool, args, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(updateLoanService).not.toHaveBeenCalled();
  });
});

describe('link_loan_payments', () => {
  const tool = captureTools({ register: registerLinkLoanPayments })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the loan id and every field of the REST body', () => {
    expect(tool.name).toBe('link_loan_payments');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['loanId', ...Object.keys(linkLoanPaymentsBodySchema.shape)].toSorted(),
    );
    expect(tool.config.description).toMatch(/confirmOverpay/);
  });

  it('applies the REST validation: 1 to 500 ids, no duplicates, a boolean confirmation', () => {
    expect(schema.safeParse({ loanId: LOAN_ID, transactionIds: [TX_ID] }).success).toBe(true);
    expect(schema.safeParse({ loanId: LOAN_ID, transactionIds: [TX_ID, TX_ID_2], confirmOverpay: true }).success).toBe(
      true,
    );
    expect(schema.safeParse({ loanId: LOAN_ID, transactionIds: [] }).success).toBe(false);
    expect(schema.safeParse({ loanId: LOAN_ID, transactionIds: [TX_ID, TX_ID] }).success).toBe(false);
    expect(schema.safeParse({ loanId: LOAN_ID, transactionIds: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({ loanId: LOAN_ID, transactionIds: [TX_ID], confirmOverpay: 'yes' }).success).toBe(false);
    expect(schema.safeParse({ transactionIds: [TX_ID] }).success).toBe(false);

    const tooMany = Array.from(
      { length: 501 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    expect(schema.safeParse({ loanId: LOAN_ID, transactionIds: tooMany }).success).toBe(false);
  });

  it('links the payments for the caller and returns the loan with the linked count', async () => {
    linkService.mockResolvedValue({ linkedCount: 2 } as never);
    loanView.mockResolvedValue(makeLoanView({ paymentsCount: 5 }));

    const data = await call({
      tool,
      args: { loanId: LOAN_ID, transactionIds: [TX_ID, TX_ID_2], confirmOverpay: true },
      extra: WRITE,
    });

    expect(linkService).toHaveBeenCalledWith({
      userId: 42,
      accountId: LOAN_ID,
      transactionIds: [TX_ID, TX_ID_2],
      confirmOverpay: true,
    });
    expect(loanView).toHaveBeenCalledWith({ userId: 42, accountId: LOAN_ID });
    expect(data).toEqual({ loan: presentedLoan({ paymentsCount: 5 }), linkedCount: 2 });
  });

  it('lets a service error through, such as an overpayment that was not confirmed', async () => {
    linkService.mockRejectedValue(new ValidationError({ message: 'Payments exceed the balance' }));

    await expect(call({ tool, args: { loanId: LOAN_ID, transactionIds: [TX_ID] }, extra: WRITE })).rejects.toThrow(
      'Payments exceed the balance',
    );
    expect(loanView).not.toHaveBeenCalled();
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { loanId: LOAN_ID, transactionIds: [TX_ID] };

    await expect(call({ tool, args, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(linkService).not.toHaveBeenCalled();
  });
});

describe('unlink_loan_payment', () => {
  const tool = captureTools({ register: registerUnlinkLoanPayment })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name with the loan id and every field of the REST body', () => {
    expect(tool.name).toBe('unlink_loan_payment');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['loanId', ...Object.keys(unlinkLoanPaymentBodySchema.shape)].toSorted(),
    );
    expect(schema.safeParse({ loanId: LOAN_ID, transactionId: TX_ID }).success).toBe(true);
    expect(schema.safeParse({ loanId: LOAN_ID }).success).toBe(false);
    expect(schema.safeParse({ loanId: LOAN_ID, transactionId: 'nope' }).success).toBe(false);
  });

  it('unlinks the payment for the caller and returns the loan with the restored transaction', async () => {
    unlinkService.mockResolvedValue({ restoredTransactionId: TX_ID } as never);
    loanView.mockResolvedValue(makeLoanView({ paymentsCount: 2 }));

    const data = await call({ tool, args: { loanId: LOAN_ID, transactionId: TX_ID_2 }, extra: WRITE });

    expect(unlinkService).toHaveBeenCalledWith({ userId: 42, accountId: LOAN_ID, transactionId: TX_ID_2 });
    expect(loanView).toHaveBeenCalledWith({ userId: 42, accountId: LOAN_ID });
    expect(data).toEqual({ loan: presentedLoan({ paymentsCount: 2 }), restoredTransactionId: TX_ID });
  });

  it('lets a service error through, such as a transaction that is not a payment of the loan', async () => {
    unlinkService.mockRejectedValue(new NotFoundError({ message: 'Payment not found' }));

    await expect(call({ tool, args: { loanId: LOAN_ID, transactionId: TX_ID }, extra: WRITE })).rejects.toThrow(
      'Payment not found',
    );
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { loanId: LOAN_ID, transactionId: TX_ID };

    await expect(call({ tool, args, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(unlinkService).not.toHaveBeenCalled();
  });
});
