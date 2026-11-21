import { VENTURE_DEAL_STATUS, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@js/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { logger } from '@js/utils/logger';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEvents from '@models/venture/venture-events.model';

import { computeIrr } from './compute-irr';

describe('computeIrr', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('all cash-flow points on the same day → null', () => {
    const deal = {
      id: 'deal-1',
      status: VENTURE_DEAL_STATUS.outstanding,
      investmentDate: '2026-05-10',
      principal: Money.fromDecimal('10000'),
      entryFee: Money.fromDecimal('0'),
    } as unknown as VentureDeals;

    const result = computeIrr({
      deal,
      events: [],
      currentValue: '12000',
      asOfDate: new Date('2026-05-10T18:00:00.000Z'),
    });

    expect(result).toBeNull();
  });

  it('open deal whose value collapsed within a month (xirr does not converge) → null, logged below warn', () => {
    const asOfDate = new Date('2026-06-01T00:00:00.000Z');
    const deal = {
      id: 'deal-2',
      status: VENTURE_DEAL_STATUS.outstanding,
      investmentDate: new Date(asOfDate.getTime() - 32 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      principal: Money.fromDecimal('1000'),
      entryFee: Money.fromDecimal('0'),
    } as unknown as VentureDeals;

    expect(computeIrr({ deal, events: [], currentValue: '1', asOfDate })).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('could not converge'));
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('capital_refund counts as an inflow (refund + residual = principal → ~0% IRR)', () => {
    const deal = {
      id: 'deal-3',
      status: VENTURE_DEAL_STATUS.outstanding,
      investmentDate: '2026-01-01',
      principal: Money.fromDecimal('10000'),
      entryFee: Money.fromDecimal('0'),
    } as unknown as VentureDeals;
    const refund = {
      type: VENTURE_EVENT_TYPE.capital_refund,
      eventDate: '2026-07-01',
      lpNetAmount: Money.fromDecimal('1000'),
    } as unknown as VentureEvents;

    const irr = computeIrr({ deal, events: [refund], currentValue: '9000', asOfDate: new Date('2027-01-01') });

    expect(Number(irr)).toBeCloseTo(0, 4);
  });
});
