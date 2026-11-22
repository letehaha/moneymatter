import { PROMOTIONS, type Promotion, applyPercentOff, getActivePromotion } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

const promo = (overrides: Partial<Promotion> = {}): Promotion => ({
  id: 'sale',
  name: 'Sale',
  stripeCouponId: 'sale_coupon',
  percentOff: 30,
  startsAt: '2026-11-22T00:00:00.000Z',
  endsAt: '2026-12-01T23:59:59.999Z',
  ...overrides,
});

const at = (iso: string) => new Date(iso);

describe('getActivePromotion', () => {
  const promotions = [promo()];

  it('resolves only inside the window, bounds inclusive', () => {
    expect(getActivePromotion({ now: at('2026-11-21T23:59:59.999Z'), promotions })).toBeNull();
    expect(getActivePromotion({ now: at('2026-11-22T00:00:00.000Z'), promotions })?.id).toBe('sale');
    expect(getActivePromotion({ now: at('2026-12-01T23:59:59.999Z'), promotions })?.id).toBe('sale');
    expect(getActivePromotion({ now: at('2026-12-02T00:00:00.000Z'), promotions })).toBeNull();
  });

  it('skips a tier or cycle outside the scope', () => {
    const scoped = [promo({ tiers: ['plus'], cycles: ['year'] })];
    const now = at('2026-11-25T12:00:00.000Z');

    expect(getActivePromotion({ now, tier: 'plus', cycle: 'year', promotions: scoped })?.id).toBe('sale');
    expect(getActivePromotion({ now, tier: 'essential', cycle: 'year', promotions: scoped })).toBeNull();
    expect(getActivePromotion({ now, tier: 'plus', cycle: 'month', promotions: scoped })).toBeNull();
    expect(getActivePromotion({ now, promotions: scoped })?.id).toBe('sale');
  });

  it('picks the highest discount, then the earliest end, then list order', () => {
    const now = at('2026-11-25T12:00:00.000Z');
    const late = promo({ id: 'late', endsAt: '2026-12-20T00:00:00.000Z' });
    const early = promo({ id: 'early', endsAt: '2026-11-30T00:00:00.000Z' });
    const bigger = promo({ id: 'bigger', percentOff: 40, endsAt: '2026-12-31T00:00:00.000Z' });
    const twin = promo({ id: 'twin', endsAt: '2026-11-30T00:00:00.000Z' });

    expect(getActivePromotion({ now, promotions: [late, early, bigger] })?.id).toBe('bigger');
    expect(getActivePromotion({ now, promotions: [late, early] })?.id).toBe('early');
    expect(getActivePromotion({ now, promotions: [early, twin] })?.id).toBe('early');
    expect(getActivePromotion({ now, promotions: [twin, early] })?.id).toBe('twin');
  });
});

describe('PROMOTIONS config', () => {
  it.each(PROMOTIONS.map((promotion) => [promotion.id, promotion] as const))(
    '%s has a valid window, discount and scope',
    (_id, promotion) => {
      const starts = Date.parse(promotion.startsAt);
      const ends = Date.parse(promotion.endsAt);
      expect(Number.isFinite(starts) && Number.isFinite(ends)).toBe(true);
      expect(starts).toBeLessThan(ends);
      expect(promotion.percentOff).toBeGreaterThan(0);
      expect(promotion.percentOff).toBeLessThanOrEqual(100);
      expect(promotion.stripeCouponId).not.toBe('');
      expect(promotion.tiers?.length ?? 1).toBeGreaterThan(0);
      expect(promotion.cycles?.length ?? 1).toBeGreaterThan(0);
    },
  );

  it('has unique ids', () => {
    expect(new Set(PROMOTIONS.map((promotion) => promotion.id)).size).toBe(PROMOTIONS.length);
  });
});

describe('applyPercentOff', () => {
  it('rounds the discount to whole cents', () => {
    expect(applyPercentOff({ price: 55, percentOff: 30 })).toBe(38.5);
    expect(applyPercentOff({ price: 8, percentOff: 30 })).toBe(5.6);
    expect(applyPercentOff({ price: 30, percentOff: 30 })).toBe(21);
    expect(applyPercentOff({ price: 4.99, percentOff: 15 })).toBe(4.24);
  });
});
