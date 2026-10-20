import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createPortfolio } from '@services/investments/portfolios/create.service';
import { linkTransactionToPortfolio, portfolioToAccountTransfer } from '@services/investments/portfolios/transfers';
import { updatePortfolio } from '@services/investments/portfolios/update.service';
import { editTracker } from '@services/trackers/edit-tracker';
import { createVentureDeal } from '@services/venture/deals/create.service';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/investments/portfolios/create.service', () => ({ createPortfolio: jest.fn() }));
jest.mock('@services/investments/portfolios/update.service', () => ({ updatePortfolio: jest.fn() }));
jest.mock('@services/investments/portfolios/transfers', () => ({
  linkTransactionToPortfolio: jest.fn(),
  portfolioToAccountTransfer: jest.fn(),
}));
jest.mock('@services/trackers/edit-tracker', () => ({ editTracker: jest.fn() }));
jest.mock('@root/serializers/trackers.serializer', () => ({ serializeTracker: (tracker: unknown) => tracker }));
jest.mock('@services/venture/deals/create.service', () => ({ createVentureDeal: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerCreatePortfolio } from './create-portfolio';
import { registerCreateVentureDeal } from './create-venture-deal';
import { registerLinkTransactionToPortfolio } from './link-transaction-to-portfolio';
import { registerTransferPortfolioToAccount } from './transfer-portfolio-to-account';
import { registerUpdatePortfolio } from './update-portfolio';
import { registerUpdateTracker } from './update-tracker';

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const create = jest.mocked(createPortfolio);
const update = jest.mocked(updatePortfolio);
const linkTx = jest.mocked(linkTransactionToPortfolio);
const portfolioToAccount = jest.mocked(portfolioToAccountTransfer);
const edit = jest.mocked(editTracker);
const createDeal = jest.mocked(createVentureDeal);

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

const toolOf = (register: Parameters<typeof captureTools>[0]['register']) => {
  const tool = captureTools({ register })[0]!;
  return { tool, schema: z.object(tool.config.inputSchema ?? {}) };
};

const makeTransfer = () => ({
  id: ID_C,
  date: '2026-10-05',
  amount: Money.fromDecimal(10),
  refAmount: Money.fromDecimal(10),
  currencyCode: 'USD',
  description: null,
  isAdjustment: false,
  affectsCash: false,
  transactionId: ID_B,
  fromAccountId: null,
  toAccountId: null,
  fromPortfolioId: ID_A,
  toPortfolioId: null,
  toCurrencyCode: null,
  toAmount: null,
});

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
});

describe('create_portfolio displayCurrencyCode', () => {
  const { tool, schema } = toolOf(registerCreatePortfolio);
  const base = { name: 'Brokerage', portfolioType: 'investment' };

  it('accepts an ISO code or null and rejects a malformed one', () => {
    expect(schema.safeParse({ ...base, displayCurrencyCode: 'EUR' }).success).toBe(true);
    expect(schema.safeParse({ ...base, displayCurrencyCode: null }).success).toBe(true);
    expect(schema.safeParse({ ...base, displayCurrencyCode: 'euro!' }).success).toBe(false);
  });

  it('passes it to the service', async () => {
    create.mockResolvedValue({ id: ID_A } as never);
    await tool.handler({ ...base, displayCurrencyCode: 'EUR' }, WRITE);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ displayCurrencyCode: 'EUR' }));
  });
});

describe('update_portfolio displayCurrencyCode', () => {
  const { tool, schema } = toolOf(registerUpdatePortfolio);

  it('accepts an ISO code or null and rejects a malformed one', () => {
    expect(schema.safeParse({ portfolioId: ID_A, displayCurrencyCode: 'EUR' }).success).toBe(true);
    expect(schema.safeParse({ portfolioId: ID_A, displayCurrencyCode: null }).success).toBe(true);
    expect(schema.safeParse({ portfolioId: ID_A, displayCurrencyCode: 'euro!' }).success).toBe(false);
  });

  it('passes a code and a null clear to the service', async () => {
    update.mockResolvedValue({ id: ID_A } as never);
    await tool.handler({ portfolioId: ID_A, displayCurrencyCode: 'EUR' }, WRITE);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ displayCurrencyCode: 'EUR' }));
    await tool.handler({ portfolioId: ID_A, displayCurrencyCode: null }, WRITE);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ displayCurrencyCode: null }));
  });
});

describe('create_venture_deal vehicleType', () => {
  const { tool, schema } = toolOf(registerCreateVentureDeal);
  const base = { name: 'Deal', currencyCode: 'USD', principal: '1000', investmentDate: '2026-01-01' };

  it('accepts spv and rejects an unknown vehicle type', () => {
    expect(schema.safeParse({ ...base, vehicleType: 'spv' }).success).toBe(true);
    expect(schema.safeParse({ ...base, vehicleType: 'fund' }).success).toBe(false);
  });

  it('passes it to the service', async () => {
    createDeal.mockResolvedValue({ id: ID_A } as never);
    await tool.handler({ ...base, vehicleType: 'spv' }, WRITE);
    expect(createDeal).toHaveBeenCalledWith(expect.objectContaining({ vehicleType: 'spv' }));
  });
});

describe('update_tracker archivePromptDismissed and nullable dates', () => {
  const { tool, schema } = toolOf(registerUpdateTracker);

  it('accepts a boolean flag and null dates, rejects a non-boolean flag', () => {
    expect(schema.safeParse({ trackerId: ID_A, archivePromptDismissed: true }).success).toBe(true);
    expect(schema.safeParse({ trackerId: ID_A, startDate: null, endDate: null }).success).toBe(true);
    expect(schema.safeParse({ trackerId: ID_A, archivePromptDismissed: 'yes' }).success).toBe(false);
  });

  it('passes them to the service', async () => {
    edit.mockResolvedValue({ id: ID_A } as never);
    await tool.handler({ trackerId: ID_A, archivePromptDismissed: true, startDate: null, endDate: null }, WRITE);
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({ archivePromptDismissed: true, startDate: null, endDate: null }),
    );
  });
});

describe('link_transaction_to_portfolio affectsCash', () => {
  const { tool, schema } = toolOf(registerLinkTransactionToPortfolio);

  it('accepts a boolean and rejects other values', () => {
    expect(schema.safeParse({ transactionId: ID_B, portfolioId: ID_A, affectsCash: false }).success).toBe(true);
    expect(schema.safeParse({ transactionId: ID_B, portfolioId: ID_A, affectsCash: 'no' }).success).toBe(false);
  });

  it('passes it to the service and shows it in the result', async () => {
    linkTx.mockResolvedValue(makeTransfer() as never);
    const result = await tool.handler({ transactionId: ID_B, portfolioId: ID_A, affectsCash: false }, WRITE);
    expect(linkTx).toHaveBeenCalledWith(expect.objectContaining({ affectsCash: false }));
    expect(parseToolResult({ result })).toMatchObject({ affectsCash: false });
  });
});

describe('transfer_portfolio_to_account existingTransactionId', () => {
  const { tool, schema } = toolOf(registerTransferPortfolioToAccount);
  const base = { portfolioId: ID_A, accountId: ID_C, amount: '10', currencyCode: 'USD', date: '2026-10-05' };

  it('accepts a record id and rejects garbage', () => {
    expect(schema.safeParse({ ...base, existingTransactionId: ID_B }).success).toBe(true);
    expect(schema.safeParse({ ...base, existingTransactionId: 'nope' }).success).toBe(false);
  });

  it('passes it to the service', async () => {
    portfolioToAccount.mockResolvedValue(makeTransfer() as never);
    await tool.handler({ ...base, existingTransactionId: ID_B }, WRITE);
    expect(portfolioToAccount).toHaveBeenCalledWith(expect.objectContaining({ existingTransactionId: ID_B }));
  });
});
