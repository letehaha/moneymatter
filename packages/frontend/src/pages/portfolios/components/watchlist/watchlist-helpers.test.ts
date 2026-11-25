import { WATCHLIST_LIMITS, type RecordId, type WatchlistItemModel, type WatchlistModel } from '@bt/shared/types';

import {
  buildLayoutPayload,
  distanceToTargetPercent,
  isPriceInputInvalid,
  layoutStateFrom,
  rangePositionPercent,
  priceInputToDecimal,
  toDecimalString,
} from './watchlist-helpers';

const item = ({ id, ...rest }: Omit<Partial<WatchlistItemModel>, 'id'> & { id: string }) =>
  ({
    id: id as RecordId,
    sectionId: null,
    note: null,
    targetPrice: null,
    lastClose: null,
    lastCloseDate: null,
    previousClose: null,
    changePercent: null,
    low52w: null,
    high52w: null,
    isHeld: false,
    alerts: [],
    ...rest,
  }) as WatchlistItemModel;

describe('layout state', () => {
  it('round-trips the watchlist into the layout payload', () => {
    const watchlist: WatchlistModel = {
      ungroupedItems: [item({ id: 'u1' })],
      sections: [
        { id: 's1' as RecordId, name: 'Buy', items: [item({ id: 'a' }), item({ id: 'b' })] },
        { id: 's2' as RecordId, name: 'Empty', items: [] },
      ],
    };
    const state = layoutStateFrom({ watchlist });
    state.ungrouped.push(state.sections[0]!.items.shift()!);

    expect(buildLayoutPayload({ state })).toEqual({
      sections: [
        { id: 's1', itemIds: ['b'] },
        { id: 's2', itemIds: [] },
      ],
      ungroupedItemIds: ['u1', 'a'],
    });
    expect(watchlist.sections[0]!.items).toHaveLength(2);
  });
});

describe('distanceToTargetPercent', () => {
  it('is the drop still needed, relative to the close', () => {
    expect(distanceToTargetPercent({ item: { lastClose: '171.2', targetPrice: '160' } })).toBeCloseTo(6.54, 2);
  });

  it('is zero or negative once the close is in the buy zone', () => {
    expect(distanceToTargetPercent({ item: { lastClose: '54.1', targetPrice: '55' } })).toBeLessThan(0);
  });

  it('is null without a target or a close', () => {
    expect(distanceToTargetPercent({ item: { lastClose: '10', targetPrice: null } })).toBeNull();
    expect(distanceToTargetPercent({ item: { lastClose: null, targetPrice: '10' } })).toBeNull();
  });

  it('is zero when the close sits on the target', () => {
    expect(distanceToTargetPercent({ item: { lastClose: '55', targetPrice: '55' } })).toBe(0);
  });

  it('is null on a zero close instead of dividing by it', () => {
    expect(distanceToTargetPercent({ item: { lastClose: '0', targetPrice: '10' } })).toBeNull();
  });
});

describe('rangePositionPercent', () => {
  it('places the close within the range and clamps outside it', () => {
    expect(rangePositionPercent({ item: { lastClose: '15', low52w: '10', high52w: '20' } })).toBe(50);
    expect(rangePositionPercent({ item: { lastClose: '25', low52w: '10', high52w: '20' } })).toBe(100);
    expect(rangePositionPercent({ item: { lastClose: '5', low52w: '10', high52w: '20' } })).toBe(0);
  });

  it('centres the close when the range has no width', () => {
    expect(rangePositionPercent({ item: { lastClose: '10', low52w: '10', high52w: '10' } })).toBe(50);
    expect(rangePositionPercent({ item: { lastClose: '10', low52w: '20', high52w: '10' } })).toBe(50);
  });

  it('is null without a range or a close', () => {
    expect(rangePositionPercent({ item: { lastClose: '15', low52w: null, high52w: null } })).toBeNull();
    expect(rangePositionPercent({ item: { lastClose: null, low52w: '10', high52w: '20' } })).toBeNull();
  });
});

describe('toDecimalString', () => {
  it('never uses exponent notation', () => {
    expect(toDecimalString({ value: 0.0000001 })).toBe('0.0000001');
    expect(toDecimalString({ value: 1234567.5 })).toBe('1234567.5');
  });

  it('keeps at most 10 fraction digits', () => {
    expect(toDecimalString({ value: 0.12345678916 })).toBe('0.1234567892');
  });
});

describe('priceInputToDecimal', () => {
  it('turns positive inputs into decimals and everything else into null', () => {
    expect(priceInputToDecimal({ value: 160.5 })).toBe('160.5');
    expect(priceInputToDecimal({ value: '0.00001' })).toBe('0.00001');
    expect(priceInputToDecimal({ value: '' })).toBeNull();
    expect(priceInputToDecimal({ value: null })).toBeNull();
    expect(priceInputToDecimal({ value: 0 })).toBeNull();
    expect(priceInputToDecimal({ value: -5 })).toBeNull();
    expect(priceInputToDecimal({ value: 'abc' })).toBeNull();
    expect(priceInputToDecimal({ value: NaN })).toBeNull();
  });
});

describe('isPriceInputInvalid', () => {
  it('accepts an empty field, which clears the price', () => {
    expect(isPriceInputInvalid({ value: null })).toBe(false);
    expect(isPriceInputInvalid({ value: '' })).toBe(false);
    expect(isPriceInputInvalid({ value: '12.5' })).toBe(false);
  });

  it('rejects anything filled in that is not a positive number', () => {
    expect(isPriceInputInvalid({ value: 0 })).toBe(true);
    expect(isPriceInputInvalid({ value: -5 })).toBe(true);
    expect(isPriceInputInvalid({ value: 'abc' })).toBe(true);
    expect(isPriceInputInvalid({ value: NaN })).toBe(true);
  });

  it('rejects prices at or above the API limit', () => {
    expect(isPriceInputInvalid({ value: WATCHLIST_LIMITS.priceBelow - 1 })).toBe(false);
    expect(isPriceInputInvalid({ value: WATCHLIST_LIMITS.priceBelow })).toBe(true);
    expect(priceInputToDecimal({ value: WATCHLIST_LIMITS.priceBelow })).toBeNull();
  });
});
