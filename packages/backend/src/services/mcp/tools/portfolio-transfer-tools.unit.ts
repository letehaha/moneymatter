import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { Money } from '@common/types/money';
import {
  exchangeCurrencyBodySchema,
  portfolioTransferBodySchema,
  transferAdjustmentBodySchema,
} from '@controllers/investments/portfolios/schemas';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NotFoundError, ValidationError } from '@js/errors';
import { getPortfolioSummaries } from '@services/investments/portfolios/get-portfolio-summaries.service';
import { getPortfoliosAnnualizedReturns } from '@services/investments/portfolios/get-portfolios-annualized-returns.service';
import { getPortfolio } from '@services/investments/portfolios/get.service';
import { restorePortfolio } from '@services/investments/portfolios/restore.service';
import {
  createPortfolioTransfer,
  deletePortfolioTransfer,
  exchangeCurrency,
  setTransferAdjustment,
} from '@services/investments/portfolios/transfers';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/investments/portfolios/get.service', () => ({ getPortfolio: jest.fn() }));
jest.mock('@services/investments/portfolios/restore.service', () => ({ restorePortfolio: jest.fn() }));
jest.mock('@services/investments/portfolios/get-portfolio-summaries.service', () => ({
  getPortfolioSummaries: jest.fn(),
}));
jest.mock('@services/investments/portfolios/get-portfolios-annualized-returns.service', () => ({
  getPortfoliosAnnualizedReturns: jest.fn(),
}));
jest.mock('@services/investments/portfolios/transfers', () => ({
  createPortfolioTransfer: jest.fn(),
  exchangeCurrency: jest.fn(),
  setTransferAdjustment: jest.fn(),
  deletePortfolioTransfer: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerDeletePortfolioTransfer } from './delete-portfolio-transfer';
import { registerExchangePortfolioCurrency } from './exchange-portfolio-currency';
import { registerGetPortfolio } from './get-portfolio';
import { registerGetPortfoliosOverview } from './get-portfolios-overview';
import { registerRestorePortfolio } from './restore-portfolio';
import { registerSetPortfolioTransferAdjustment } from './set-portfolio-transfer-adjustment';
import { registerTransferBetweenPortfolios } from './transfer-between-portfolios';

const READ_ONLY = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE_ONLY = makeExtra({ scopes: ['finance:read', 'finance:delete'] });
const NO_WRITE_SCOPE = makeExtra({ scopes: ['finance:read'] });
const READ_ONLY_USER_WITH_SCOPES = makeExtra({ readOnly: true });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const portfolioById = jest.mocked(getPortfolio);
const restore = jest.mocked(restorePortfolio);
const summaries = jest.mocked(getPortfolioSummaries);
const annualizedReturns = jest.mocked(getPortfoliosAnnualizedReturns);
const createTransfer = jest.mocked(createPortfolioTransfer);
const exchange = jest.mocked(exchangeCurrency);
const setAdjustment = jest.mocked(setTransferAdjustment);
const deleteTransfer = jest.mocked(deletePortfolioTransfer);

const PORTFOLIO_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PORTFOLIO_ID = '22222222-2222-4222-8222-222222222222';
const TRANSFER_ID = '33333333-3333-4333-8333-333333333333';

const call = async ({
  tool,
  args,
  extra = READ_ONLY,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

const makePortfolio = (patch: Record<string, unknown> = {}) => ({
  id: PORTFOLIO_ID,
  name: 'Brokerage',
  userId: 42,
  portfolioType: PORTFOLIO_TYPE.investment,
  description: 'main',
  displayCurrencyCode: null,
  isEnabled: true,
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
  updatedAt: new Date('2026-10-02T10:00:00.000Z'),
  deletedAt: null,
  ...patch,
});

/** A transfer model as the services return it: Money amounts, the owner id and audit fields included. */
const makeTransfer = (patch: Record<string, unknown> = {}) => ({
  id: TRANSFER_ID,
  userId: 42,
  date: '2026-10-05',
  amount: Money.fromDecimal(100.5),
  refAmount: Money.fromDecimal(100.5),
  currencyCode: 'USD',
  description: 'top up',
  isAdjustment: false,
  affectsCash: true,
  transactionId: null,
  fromAccountId: null,
  toAccountId: null,
  fromPortfolioId: PORTFOLIO_ID,
  toPortfolioId: OTHER_PORTFOLIO_ID,
  toCurrencyCode: null,
  toAmount: null,
  createdAt: new Date('2026-10-05T10:00:00.000Z'),
  ...patch,
});

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('get_portfolio', () => {
  const tool = captureTools({ register: registerGetPortfolio })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and takes only a portfolio id', () => {
    expect(tool.name).toBe('get_portfolio');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['portfolioId']);
    expect(schema.safeParse({ portfolioId: PORTFOLIO_ID }).success).toBe(true);
    expect(schema.safeParse({ portfolioId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('reads the portfolio for the caller, slimmed, and works for a read-only user during a base-currency change', async () => {
    lockCheck.mockResolvedValue(true);
    portfolioById.mockResolvedValue(makePortfolio() as never);

    const data = await call({ tool, args: { portfolioId: PORTFOLIO_ID }, extra: READ_ONLY });

    expect(portfolioById).toHaveBeenCalledWith({ userId: 42, portfolioId: PORTFOLIO_ID });
    expect(data).toEqual({
      id: PORTFOLIO_ID,
      name: 'Brokerage',
      portfolioType: PORTFOLIO_TYPE.investment,
      description: 'main',
      isEnabled: true,
      createdAt: '2026-10-01T10:00:00.000Z',
    });
  });

  it("passes another user's portfolio through as the service not-found error", async () => {
    portfolioById.mockRejectedValue(new NotFoundError({ message: 'Portfolio not found' }));

    await expect(call({ tool, args: { portfolioId: PORTFOLIO_ID } })).rejects.toThrow('Portfolio not found');
    expect(portfolioById).toHaveBeenCalledWith({ userId: 42, portfolioId: PORTFOLIO_ID });
  });
});

describe('get_portfolios_overview', () => {
  const tool = captureTools({ register: registerGetPortfoliosOverview })[0]!;

  it('registers under its name with no input', () => {
    expect(tool.name).toBe('get_portfolios_overview');
    expect(tool.config.inputSchema).toBeUndefined();
    expect(tool.config.description).toMatch(/summar/i);
    expect(tool.config.description).toMatch(/annualized/i);
  });

  it('returns the summaries and the annualized returns of the caller side by side', async () => {
    const summary = { portfolioId: PORTFOLIO_ID, portfolioName: 'Brokerage', totalCurrentValue: '1200.50' };
    const annualized = { portfolioId: PORTFOLIO_ID, portfolioName: 'Brokerage', annualizedReturn: 0.07 };
    summaries.mockResolvedValue([summary] as never);
    annualizedReturns.mockResolvedValue([annualized] as never);

    const data = await call({ tool, extra: READ_ONLY });

    expect(summaries).toHaveBeenCalledWith({ userId: 42 });
    expect(annualizedReturns).toHaveBeenCalledWith({ userId: 42 });
    expect(data).toEqual({ summaries: [summary], annualizedReturns: [annualized] });
  });

  it('returns two empty lists for a user without portfolios', async () => {
    summaries.mockResolvedValue([]);
    annualizedReturns.mockResolvedValue([]);

    expect(await call({ tool })).toEqual({ summaries: [], annualizedReturns: [] });
  });

  it('fails when either report fails, rather than returning half an overview', async () => {
    summaries.mockResolvedValue([]);
    annualizedReturns.mockRejectedValue(new Error('boom'));

    await expect(call({ tool })).rejects.toThrow('boom');
  });
});

describe('transfer_between_portfolios', () => {
  const tool = captureTools({ register: registerTransferBetweenPortfolios })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const base = {
    fromPortfolioId: PORTFOLIO_ID,
    toPortfolioId: OTHER_PORTFOLIO_ID,
    currencyCode: 'USD',
    amount: '100.50',
    date: '2026-10-05',
  };

  it('registers under its name and declares the source id plus every field of the REST body schema', () => {
    expect(tool.name).toBe('transfer_between_portfolios');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['fromPortfolioId', ...Object.keys(portfolioTransferBodySchema.shape)].toSorted(),
    );
  });

  it('applies the REST validation: positive decimal string, ISO currency, date', () => {
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, description: null }).success).toBe(true);
    expect(schema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    expect(schema.safeParse({ ...base, amount: '-5' }).success).toBe(false);
    expect(schema.safeParse({ ...base, amount: 100 }).success).toBe(false);
    expect(schema.safeParse({ ...base, currencyCode: 'ZZZZ9' }).success).toBe(false);
    expect(schema.safeParse({ ...base, date: 'yesterday' }).success).toBe(false);
    expect(schema.safeParse({ ...base, toPortfolioId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ ...base, userId: 7 }).success).toBe(false);
  });

  it('passes the fields to the service for the caller and returns the slim transfer with decimal strings', async () => {
    createTransfer.mockResolvedValue(makeTransfer() as never);

    const data = await call({ tool, args: { ...base, description: 'top up' }, extra: WRITE });

    expect(createTransfer).toHaveBeenCalledWith({
      userId: 42,
      fromPortfolioId: PORTFOLIO_ID,
      toPortfolioId: OTHER_PORTFOLIO_ID,
      currencyCode: 'USD',
      amount: '100.50',
      date: '2026-10-05',
      description: 'top up',
    });
    expect(data).toMatchObject({
      id: TRANSFER_ID,
      amount: expect.stringMatching(/^100\.5/),
      refAmount: expect.stringMatching(/^100\.5/),
      fromPortfolioId: PORTFOLIO_ID,
      toPortfolioId: OTHER_PORTFOLIO_ID,
    });
    expect(data).not.toHaveProperty('userId');
    expect(data).not.toHaveProperty('createdAt');
  });

  it('sends a missing or empty description as null, as the REST controller does', async () => {
    createTransfer.mockResolvedValue(makeTransfer() as never);

    await call({ tool, args: base, extra: WRITE });
    await call({ tool, args: { ...base, description: '' }, extra: WRITE });

    expect(createTransfer).toHaveBeenNthCalledWith(1, expect.objectContaining({ description: null }));
    expect(createTransfer).toHaveBeenNthCalledWith(2, expect.objectContaining({ description: null }));
  });

  it('lets a service error through, such as a same-portfolio transfer', async () => {
    createTransfer.mockRejectedValue(new ValidationError({ message: 'Source and destination must differ' }));

    await expect(call({ tool, args: base, extra: WRITE })).rejects.toThrow('Source and destination must differ');
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    await expect(call({ tool, args: base, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args: base, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    await expect(call({ tool, args: base, extra: DELETE_ONLY })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: base, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(createTransfer).not.toHaveBeenCalled();
  });
});

describe('exchange_portfolio_currency', () => {
  const tool = captureTools({ register: registerExchangePortfolioCurrency })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();
  const base = {
    portfolioId: PORTFOLIO_ID,
    fromCurrencyCode: 'USD',
    toCurrencyCode: 'EUR',
    fromAmount: '100',
    toAmount: '92.35',
    date: '2026-10-05',
  };

  it('registers under its name and declares the portfolio id plus every field of the REST body schema', () => {
    expect(tool.name).toBe('exchange_portfolio_currency');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['portfolioId', ...Object.keys(exchangeCurrencyBodySchema.shape)].toSorted(),
    );
  });

  it('applies the REST validation', () => {
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, description: null }).success).toBe(true);
    expect(schema.safeParse({ ...base, fromAmount: '0' }).success).toBe(false);
    expect(schema.safeParse({ ...base, toAmount: '-1' }).success).toBe(false);
    expect(schema.safeParse({ ...base, toCurrencyCode: 'euro!' }).success).toBe(false);
    expect(schema.safeParse({ ...base, portfolioId: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it('passes the fields to the service for the caller and returns the converted amount as a decimal string', async () => {
    exchange.mockResolvedValue(
      makeTransfer({
        toCurrencyCode: 'EUR',
        toAmount: Money.fromDecimal(92.35),
        currencyCode: 'USD',
        amount: Money.fromDecimal(-100),
      }) as never,
    );

    const data = await call({ tool, args: { ...base, description: 'fx' }, extra: WRITE });

    expect(exchange).toHaveBeenCalledWith({
      userId: 42,
      portfolioId: PORTFOLIO_ID,
      fromCurrencyCode: 'USD',
      toCurrencyCode: 'EUR',
      fromAmount: '100',
      toAmount: '92.35',
      date: '2026-10-05',
      description: 'fx',
    });
    expect(data).toMatchObject({ toCurrencyCode: 'EUR', toAmount: expect.stringMatching(/^92\.35/) });
    expect(typeof (data as { amount: unknown }).amount).toBe('string');
    expect(data).not.toHaveProperty('userId');
  });

  it('sends a missing description as null', async () => {
    exchange.mockResolvedValue(makeTransfer() as never);

    await call({ tool, args: base, extra: WRITE });

    expect(exchange).toHaveBeenCalledWith(expect.objectContaining({ description: null }));
  });

  it('lets a service error through, such as the same currency on both sides', async () => {
    exchange.mockRejectedValue(new ValidationError({ message: 'Currencies must differ' }));

    await expect(call({ tool, args: { ...base, toCurrencyCode: 'USD' }, extra: WRITE })).rejects.toThrow(
      'Currencies must differ',
    );
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    await expect(call({ tool, args: base, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args: base, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args: base, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(exchange).not.toHaveBeenCalled();
  });
});

describe('set_portfolio_transfer_adjustment', () => {
  const tool = captureTools({ register: registerSetPortfolioTransferAdjustment })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and declares the transfer id plus every field of the REST body schema', () => {
    expect(tool.name).toBe('set_portfolio_transfer_adjustment');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(
      ['transferId', ...Object.keys(transferAdjustmentBodySchema.shape)].toSorted(),
    );
    expect(tool.config.description).toMatch(/contribution/i);
  });

  it('requires a boolean flag and a transfer id', () => {
    expect(schema.safeParse({ transferId: TRANSFER_ID, isAdjustment: true }).success).toBe(true);
    expect(schema.safeParse({ transferId: TRANSFER_ID, isAdjustment: 'yes' }).success).toBe(false);
    expect(schema.safeParse({ transferId: TRANSFER_ID }).success).toBe(false);
    expect(schema.safeParse({ transferId: 'nope', isAdjustment: true }).success).toBe(false);
  });

  it('flags the transfer for the caller and returns the slim transfer', async () => {
    setAdjustment.mockResolvedValue(makeTransfer({ isAdjustment: true }) as never);

    const data = await call({ tool, args: { transferId: TRANSFER_ID, isAdjustment: true }, extra: WRITE });

    expect(setAdjustment).toHaveBeenCalledWith({ userId: 42, transferId: TRANSFER_ID, isAdjustment: true });
    expect(data).toMatchObject({ id: TRANSFER_ID, isAdjustment: true });
    expect(data).not.toHaveProperty('userId');
  });

  it("passes another user's transfer through as the service not-found error", async () => {
    setAdjustment.mockRejectedValue(new NotFoundError({ message: 'Transfer not found' }));

    await expect(call({ tool, args: { transferId: TRANSFER_ID, isAdjustment: false }, extra: WRITE })).rejects.toThrow(
      'Transfer not found',
    );
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { transferId: TRANSFER_ID, isAdjustment: true };

    await expect(call({ tool, args, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(setAdjustment).not.toHaveBeenCalled();
  });
});

describe('delete_portfolio_transfer', () => {
  const tool = captureTools({ register: registerDeletePortfolioTransfer })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and says what happens to the linked bank transaction', () => {
    expect(tool.name).toBe('delete_portfolio_transfer');
    expect(Object.keys(tool.config.inputSchema ?? {}).toSorted()).toEqual(['deleteLinkedTransaction', 'transferId']);
    expect(tool.config.description).toMatch(/linked/i);
    expect(tool.config.description).toMatch(/irreversible|permanent/i);
  });

  it('requires a transfer id and a boolean flag', () => {
    expect(schema.safeParse({ transferId: TRANSFER_ID }).success).toBe(true);
    expect(schema.safeParse({ transferId: TRANSFER_ID, deleteLinkedTransaction: true }).success).toBe(true);
    expect(schema.safeParse({ transferId: TRANSFER_ID, deleteLinkedTransaction: 'true' }).success).toBe(false);
    expect(schema.safeParse({ transferId: 'nope' }).success).toBe(false);
  });

  it('deletes the transfer for the caller and keeps the linked transaction by default', async () => {
    deleteTransfer.mockResolvedValue({ success: true } as never);

    const data = await call({ tool, args: { transferId: TRANSFER_ID }, extra: DELETE_ONLY });

    expect(deleteTransfer).toHaveBeenCalledWith({
      userId: 42,
      transferId: TRANSFER_ID,
      deleteLinkedTransaction: false,
    });
    expect(data).toEqual({ deleted: true, id: TRANSFER_ID });
  });

  it('passes deleteLinkedTransaction through', async () => {
    deleteTransfer.mockResolvedValue({ success: true } as never);

    await call({ tool, args: { transferId: TRANSFER_ID, deleteLinkedTransaction: true }, extra: DELETE_ONLY });

    expect(deleteTransfer).toHaveBeenCalledWith({ userId: 42, transferId: TRANSFER_ID, deleteLinkedTransaction: true });
  });

  it('refuses a read-only user, a write-only scope and a base-currency change, before the service', async () => {
    const args = { transferId: TRANSFER_ID };

    await expect(call({ tool, args, extra: makeExtra({ readOnly: true }) })).rejects.toThrow();
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/finance:delete/);
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:delete/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(LOCKED);
    expect(deleteTransfer).not.toHaveBeenCalled();
  });
});

describe('restore_portfolio', () => {
  const tool = captureTools({ register: registerRestorePortfolio })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and takes only a portfolio id', () => {
    expect(tool.name).toBe('restore_portfolio');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['portfolioId']);
    expect(schema.safeParse({ portfolioId: 'nope' }).success).toBe(false);
  });

  it('restores the portfolio for the caller and returns it slimmed', async () => {
    restore.mockResolvedValue(makePortfolio() as never);

    const data = await call({ tool, args: { portfolioId: PORTFOLIO_ID }, extra: WRITE });

    expect(restore).toHaveBeenCalledWith({ userId: 42, portfolioId: PORTFOLIO_ID });
    expect(data).toMatchObject({ id: PORTFOLIO_ID, name: 'Brokerage' });
    expect(data).not.toHaveProperty('userId');
    expect(data).not.toHaveProperty('deletedAt');
  });

  it('lets a service error through, such as a portfolio that is not deleted', async () => {
    restore.mockRejectedValue(new ValidationError({ message: 'Portfolio is not deleted' }));

    await expect(call({ tool, args: { portfolioId: PORTFOLIO_ID }, extra: WRITE })).rejects.toThrow(
      'Portfolio is not deleted',
    );
  });

  it('refuses a read-only user, a missing write scope and a base-currency change, before the service', async () => {
    const args = { portfolioId: PORTFOLIO_ID };

    await expect(call({ tool, args, extra: READ_ONLY_USER_WITH_SCOPES })).rejects.toThrow();
    await expect(call({ tool, args, extra: NO_WRITE_SCOPE })).rejects.toThrow(/finance:write/);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(/finance:write/);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(LOCKED);
    expect(restore).not.toHaveBeenCalled();
  });

  it('refuses a demo user, as the REST route does', async () => {
    const demo = makeExtra({ role: 'demo' });

    await expect(call({ tool, args: { portfolioId: PORTFOLIO_ID }, extra: demo })).rejects.toThrow(/demo/i);
    expect(restore).not.toHaveBeenCalled();
  });
});
