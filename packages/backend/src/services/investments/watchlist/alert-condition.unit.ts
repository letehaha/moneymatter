import { WATCHLIST_ALERT_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';

import { dailyChangePercent, isAlertConditionMet } from './alert-condition';

const closes = ({ last, previous }: { last: string; previous?: string }) => ({
  last: { day: '2026-01-02', price: last },
  previous: previous === undefined ? null : { day: '2026-01-01', price: previous },
});

const priceAlert = ({ type, price }: { type: 'close_above' | 'close_below'; price: string }) => ({
  type,
  price: Money.fromDecimal(price),
  percent: null,
});

const moveAlert = ({ percent }: { percent: number }) => ({
  type: WATCHLIST_ALERT_TYPES.dailyMove,
  price: null,
  percent,
});

describe('isAlertConditionMet', () => {
  it('fires a price alert on a close equal to its price', () => {
    expect(
      isAlertConditionMet({
        alert: priceAlert({ type: WATCHLIST_ALERT_TYPES.closeAbove, price: '100' }),
        closes: closes({ last: '100' }),
      }),
    ).toBe(true);
    expect(
      isAlertConditionMet({
        alert: priceAlert({ type: WATCHLIST_ALERT_TYPES.closeBelow, price: '100' }),
        closes: closes({ last: '100' }),
      }),
    ).toBe(true);
  });

  it('holds back a price alert on the wrong side of its price', () => {
    expect(
      isAlertConditionMet({
        alert: priceAlert({ type: WATCHLIST_ALERT_TYPES.closeAbove, price: '100' }),
        closes: closes({ last: '99.99' }),
      }),
    ).toBe(false);
    expect(
      isAlertConditionMet({
        alert: priceAlert({ type: WATCHLIST_ALERT_TYPES.closeBelow, price: '100' }),
        closes: closes({ last: '100.01' }),
      }),
    ).toBe(false);
  });

  it('fires a daily move at its percentage in either direction, and never without a previous close', () => {
    expect(
      isAlertConditionMet({ alert: moveAlert({ percent: 5 }), closes: closes({ last: '105', previous: '100' }) }),
    ).toBe(true);
    expect(
      isAlertConditionMet({ alert: moveAlert({ percent: 5 }), closes: closes({ last: '95', previous: '100' }) }),
    ).toBe(true);
    expect(
      isAlertConditionMet({ alert: moveAlert({ percent: 5 }), closes: closes({ last: '104', previous: '100' }) }),
    ).toBe(false);
    expect(isAlertConditionMet({ alert: moveAlert({ percent: 5 }), closes: closes({ last: '200' }) })).toBe(false);
  });

  it.each([
    { last: '115', percent: 15, fires: true },
    { last: '129', percent: 29, fires: true },
    { last: '71', percent: 29, fires: true },
    { last: '114.99', percent: 15, fires: false },
  ])('daily move 100 -> $last at $percent% fires: $fires', ({ last, percent, fires }) => {
    expect(isAlertConditionMet({ alert: moveAlert({ percent }), closes: closes({ last, previous: '100' }) })).toBe(
      fires,
    );
  });

  it('throws on an unknown alert type', () => {
    expect(() =>
      isAlertConditionMet({
        alert: { type: 'unknown' as 'close_below', price: Money.fromDecimal('1'), percent: null },
        closes: closes({ last: '1' }),
      }),
    ).toThrow('Unknown watchlist alert type');
  });
});

describe('dailyChangePercent', () => {
  it('is the signed change in percent points', () => {
    expect(dailyChangePercent({ closes: closes({ last: '93.5', previous: '100' }) })).toBeCloseTo(-6.5, 10);
  });

  it('is null without a positive previous close', () => {
    expect(dailyChangePercent({ closes: closes({ last: '10' }) })).toBeNull();
    expect(dailyChangePercent({ closes: closes({ last: '10', previous: '0' }) })).toBeNull();
  });
});
