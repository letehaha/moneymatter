import type { BillingCycle, BillingTier } from './billing';

export interface Promotion {
  /** Also the frontend i18n key: `settings.planBilling.promotion.names.<id>`. */
  id: string;
  /** English name, also the landing i18n key. */
  name: string;
  /** Created by hand under this id in both Stripe modes, with `duration: once`. */
  stripeCouponId: string;
  percentOff: number;
  /** ISO UTC, both bounds inclusive. */
  startsAt: string;
  endsAt: string;
  /** Omitted means every tier / cycle. */
  tiers?: readonly BillingTier[];
  cycles?: readonly BillingCycle[];
}

/** Ended entries stay: they never resolve again, and tests pin the clock against them. */
export const PROMOTIONS: readonly Promotion[] = [
  {
    id: 'blackFriday2026',
    name: 'Black Friday',
    stripeCouponId: 'black_friday_2026_30',
    percentOff: 30,
    startsAt: '2026-11-22T00:00:00.000Z',
    endsAt: '2026-12-01T23:59:59.999Z',
  },
];

const isPromotionLive = ({ promotion, now }: { promotion: Promotion; now: Date }): boolean =>
  Date.parse(promotion.startsAt) <= now.getTime() && now.getTime() <= Date.parse(promotion.endsAt);

/** An omitted `tier` or `cycle` is not checked. */
export const isPromotionInScope = ({
  promotion,
  tier,
  cycle,
}: {
  promotion: Promotion;
  tier?: BillingTier;
  cycle?: BillingCycle;
}): boolean =>
  (!tier || !promotion.tiers || promotion.tiers.includes(tier)) &&
  (!cycle || !promotion.cycles || promotion.cycles.includes(cycle));

/**
 * Overlaps resolve to the highest `percentOff`, then the earliest `endsAt`, then list order.
 * Without `tier`/`cycle` it answers "is any sale on".
 */
export const getActivePromotion = ({
  now,
  tier,
  cycle,
  promotions = PROMOTIONS,
}: {
  now: Date;
  tier?: BillingTier;
  cycle?: BillingCycle;
  promotions?: readonly Promotion[];
}): Promotion | null =>
  promotions
    .filter((promotion) => isPromotionLive({ promotion, now }) && isPromotionInScope({ promotion, tier, cycle }))
    .reduce<Promotion | null>(
      (best, promotion) =>
        !best ||
        promotion.percentOff > best.percentOff ||
        (promotion.percentOff === best.percentOff && Date.parse(promotion.endsAt) < Date.parse(best.endsAt))
          ? promotion
          : best,
      null,
    );

/** Rounds the discount to whole cents, as Stripe does: 55 at 30% is 38.5. */
export const applyPercentOff = ({ price, percentOff }: { price: number; percentOff: number }): number => {
  const cents = Math.round(price * 100);
  return (cents - Math.round((cents * percentOff) / 100)) / 100;
};
