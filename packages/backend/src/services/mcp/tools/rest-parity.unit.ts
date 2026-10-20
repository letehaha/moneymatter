import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createPortfolio } from '@services/investments/portfolios/create.service';
import { updatePortfolio } from '@services/investments/portfolios/update.service';
import { createInvestmentTransaction } from '@services/investments/transactions/create.service';
import { updateInvestmentTransaction } from '@services/investments/transactions/update.service';
import { createTracker } from '@services/trackers/create-tracker';
import { editTracker } from '@services/trackers/edit-tracker';
import { updateVentureDeal } from '@services/venture/deals/update.service';
import { createVenturePlatform } from '@services/venture/platforms/create.service';
import { updateVenturePlatform } from '@services/venture/platforms/update.service';
import { captureTools, makeExtra } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/investments/transactions/create.service', () => ({ createInvestmentTransaction: jest.fn() }));
jest.mock('@services/investments/transactions/update.service', () => ({ updateInvestmentTransaction: jest.fn() }));
jest.mock('@services/investments/portfolios/create.service', () => ({ createPortfolio: jest.fn() }));
jest.mock('@services/investments/portfolios/update.service', () => ({ updatePortfolio: jest.fn() }));
jest.mock('@services/trackers/create-tracker', () => ({ createTracker: jest.fn() }));
jest.mock('@services/trackers/edit-tracker', () => ({ editTracker: jest.fn() }));
jest.mock('@root/serializers/trackers.serializer', () => ({ serializeTracker: (tracker: unknown) => tracker }));
jest.mock('@services/venture/deals/update.service', () => ({ updateVentureDeal: jest.fn() }));
jest.mock('@services/venture/platforms/create.service', () => ({ createVenturePlatform: jest.fn() }));
jest.mock('@services/venture/platforms/update.service', () => ({ updateVenturePlatform: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { registerCreateInvestmentTransaction } from './create-investment-transaction';
import { registerCreatePortfolio } from './create-portfolio';
import { registerCreateTracker } from './create-tracker';
import { registerCreateVenturePlatform } from './create-venture-platform';
import { registerUpdateInvestmentTransaction } from './update-investment-transaction';
import { registerUpdatePortfolio } from './update-portfolio';
import { registerUpdateTracker } from './update-tracker';
import { registerUpdateVentureDeal } from './update-venture-deal';
import { registerUpdateVenturePlatform } from './update-venture-platform';

const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const toolOf = (register: Parameters<typeof captureTools>[0]['register']) => {
  const tool = captureTools({ register })[0]!;
  return { tool, schema: z.object(tool.config.inputSchema!) };
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(isBaseCurrencyChangeLocked).mockResolvedValue(false);
});

describe('create_investment_transaction settlement leg', () => {
  const { tool, schema } = toolOf(registerCreateInvestmentTransaction);
  const base = {
    portfolioId: ID_A,
    securityId: ID_B,
    category: 'buy',
    date: '2026-06-20',
    quantity: '10',
    price: '150',
  };

  it('takes the settlement fields and defaults the fees like the REST body', () => {
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.parse(base).fees).toBe('0');
    expect(schema.safeParse({ ...base, price: '0', fees: '0' }).success).toBe(true);
    expect(schema.safeParse({ ...base, settlementCurrencyCode: 'PLN', settlementAmount: '600' }).success).toBe(true);
  });

  it('refuses the settlement combinations the REST body refuses', async () => {
    const refused = [
      { settlementCurrencyCode: 'PLN' },
      { settlementAmount: '600' },
      { settlementRate: '4' },
      { settlementCurrencyCode: 'PLN', settlementAmount: '600', settlementFees: '1', settlementRate: '4' },
    ];
    for (const extra of refused) {
      await expect(tool.handler({ ...base, ...extra }, WRITE)).rejects.toThrow();
    }
    expect(jest.mocked(createInvestmentTransaction)).not.toHaveBeenCalled();
  });

  it('passes the settlement leg to the service', async () => {
    jest.mocked(createInvestmentTransaction).mockResolvedValue({ id: ID_A } as never);
    await tool.handler({ ...base, settlementCurrencyCode: 'PLN', settlementAmount: '600', settlementFees: '2' }, WRITE);
    expect(jest.mocked(createInvestmentTransaction)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        fees: '0',
        settlementCurrencyCode: 'PLN',
        settlementAmount: '600',
        settlementFees: '2',
      }),
    );
  });
});

describe('update_investment_transaction', () => {
  const { tool, schema } = toolOf(registerUpdateInvestmentTransaction);

  it('validates quantity, price and fees like the REST body', () => {
    expect(schema.safeParse({ transactionId: ID_A, quantity: '0' }).success).toBe(false);
    expect(schema.safeParse({ transactionId: ID_A, price: '-1' }).success).toBe(false);
    expect(schema.safeParse({ transactionId: ID_A, fees: '-1' }).success).toBe(false);
    expect(schema.safeParse({ transactionId: ID_A, price: '0', fees: '0', quantity: '2' }).success).toBe(true);
  });

  it('passes the settlement leg to the service', async () => {
    jest.mocked(updateInvestmentTransaction).mockResolvedValue({ id: ID_A } as never);
    await tool.handler({ transactionId: ID_A, settlementCurrencyCode: 'PLN', settlementRate: '4' }, WRITE);
    expect(jest.mocked(updateInvestmentTransaction)).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: ID_A, settlementCurrencyCode: 'PLN', settlementRate: '4' }),
    );
  });
});

describe('portfolio limits and empty updates', () => {
  it('create_portfolio applies the REST name and description limits', () => {
    const { schema } = toolOf(registerCreatePortfolio);
    expect(schema.safeParse({ name: 'Main' }).success).toBe(true);
    expect(schema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
    expect(schema.safeParse({ name: 'Main', description: 'x'.repeat(501) }).success).toBe(false);
  });

  it('update_portfolio refuses an update without fields and a name over 255 characters', async () => {
    const { tool, schema } = toolOf(registerUpdatePortfolio);
    expect(schema.safeParse({ portfolioId: ID_A, name: 'x'.repeat(256) }).success).toBe(false);
    await expect(tool.handler({ portfolioId: ID_A }, WRITE)).rejects.toThrow();
    expect(jest.mocked(updatePortfolio)).not.toHaveBeenCalled();

    jest.mocked(updatePortfolio).mockResolvedValue({ id: ID_A } as never);
    await tool.handler({ portfolioId: ID_A, isEnabled: false }, WRITE);
    expect(jest.mocked(updatePortfolio)).toHaveBeenCalledWith({ userId: 42, portfolioId: ID_A, isEnabled: false });
    expect(jest.mocked(createPortfolio)).not.toHaveBeenCalled();
  });
});

describe('venture limits and empty updates', () => {
  it('create_venture_platform needs a valid website url', () => {
    const { schema } = toolOf(registerCreateVenturePlatform);
    expect(schema.safeParse({ name: 'AngelList', website: 'https://angel.co' }).success).toBe(true);
    expect(schema.safeParse({ name: 'AngelList', website: 'not a url' }).success).toBe(false);
    expect(schema.safeParse({ name: '   ' }).success).toBe(false);
    expect(jest.mocked(createVenturePlatform)).not.toHaveBeenCalled();
  });

  it('update_venture_platform and update_venture_deal refuse an update without fields', async () => {
    const platform = toolOf(registerUpdateVenturePlatform);
    await expect(platform.tool.handler({ platformId: ID_A }, WRITE)).rejects.toThrow();
    expect(jest.mocked(updateVenturePlatform)).not.toHaveBeenCalled();

    const deal = toolOf(registerUpdateVentureDeal);
    expect(deal.schema.safeParse({ dealId: ID_A, notes: 'x'.repeat(5001) }).success).toBe(false);
    await expect(deal.tool.handler({ dealId: ID_A }, WRITE)).rejects.toThrow();
    expect(jest.mocked(updateVentureDeal)).not.toHaveBeenCalled();
  });
});

describe('tracker dates, limit, categories and logo', () => {
  it('create_tracker refuses a category tracker without categories and a non-positive limit', async () => {
    const { tool, schema } = toolOf(registerCreateTracker);
    expect(schema.safeParse({ name: 'Trip', limitAmount: 0 }).success).toBe(false);
    await expect(tool.handler({ name: 'Trip', type: 'category' }, WRITE)).rejects.toThrow();
    await expect(
      tool.handler({ name: 'Trip', startDate: '2026-10-05T00:00:00Z', endDate: '2026-10-01T00:00:00Z' }, WRITE),
    ).rejects.toThrow();
    await expect(tool.handler({ name: 'Trip', logoDomain: 'a.com', logoInitials: 'T' }, WRITE)).rejects.toThrow();
    expect(jest.mocked(createTracker)).not.toHaveBeenCalled();
  });

  it('create_tracker passes the logo and the limit as money to the service', async () => {
    const { tool } = toolOf(registerCreateTracker);
    jest.mocked(createTracker).mockResolvedValue({ id: ID_A } as never);

    await tool.handler({ name: 'Trip', limitAmount: 500, logoDomain: 'airbnb.com' }, WRITE);

    const call = jest.mocked(createTracker).mock.calls[0]![0] as { limitAmount: { toNumber: () => number } };
    expect(jest.mocked(createTracker)).toHaveBeenCalledWith(expect.objectContaining({ logoDomain: 'airbnb.com' }));
    expect(call.limitAmount.toNumber()).toBe(500);
  });

  it('update_tracker needs at least one category when it replaces them, and clears the dates with null', async () => {
    const { tool, schema } = toolOf(registerUpdateTracker);
    expect(schema.safeParse({ trackerId: ID_A, categoryIds: [] }).success).toBe(false);
    await expect(tool.handler({ trackerId: ID_A, logoDomain: 'a.com', logoIcon: 'x' }, WRITE)).rejects.toThrow();

    jest.mocked(editTracker).mockResolvedValue({ id: ID_A } as never);
    await tool.handler({ trackerId: ID_A, endDate: null, limitAmount: null, logoColor: '#aabbcc' }, WRITE);
    expect(jest.mocked(editTracker)).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID_A, endDate: null, limitAmount: null, logoColor: '#aabbcc' }),
    );
  });
});
