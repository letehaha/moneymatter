import { Money } from '@common/types/money';
import SecurityPricing from '@models/investments/security-pricing.model';

import { formatDateKey } from './types';

// Loaded via raw SQL (no Money hydration), so priceClose is a raw DECIMAL
// string; Money is still allowed for hydrated callers (unit tests).
type SecurityPriceRow = Pick<SecurityPricing, 'securityId' | 'date'> & {
  priceClose: Money | string;
};

interface PriceLookup {
  /** Per-security ascending-date list, binary-searched by `createFindPriceForDate`. */
  pricesBySecurity: Map<string, Array<{ date: string; price: number }>>;
  /** Direct lookup keyed `${securityId}_${dateStr}` — last write wins on intraday collisions. */
  pricesBySecurityAndDate: Map<string, number>;
}

/**
 * Index prices by security and yyyy-MM-dd. `price.date` is TIMESTAMPTZ
 * (crypto carries intraday timestamps); formatting to `yyyy-MM-dd` collapses
 * same-day intraday rows onto a single daily bucket. Rows MUST be sorted
 * ascending by date so the per-security date list is ordered for the
 * binary-search fallback; last-write-wins on the exact-match map then picks the
 * latest intraday close for that day.
 */
export const buildPriceLookup = (rows: SecurityPriceRow[]): PriceLookup => {
  const pricesBySecurity = new Map<string, Array<{ date: string; price: number }>>();
  const pricesBySecurityAndDate = new Map<string, number>();

  for (const price of rows) {
    const dateStr = formatDateKey(price.date);
    // Raw rows carry priceClose as a decimal string; hydrated callers pass Money.
    const priceValue = Money.isMoney(price.priceClose) ? price.priceClose.toNumber() : Number(price.priceClose);

    if (!pricesBySecurity.has(price.securityId)) {
      pricesBySecurity.set(price.securityId, []);
    }
    pricesBySecurity.get(price.securityId)!.push({ date: dateStr, price: priceValue });
    pricesBySecurityAndDate.set(`${price.securityId}_${dateStr}`, priceValue);
  }

  return { pricesBySecurity, pricesBySecurityAndDate };
};

/**
 * Closure factory: returns the price for `securityId` on `targetDate`, falling
 * back to the latest known prior price (handles weekends, holidays, sparse
 * coverage). Returns `null` when no price is on or before the target date.
 */
export const createFindPriceForDate = ({ pricesBySecurity, pricesBySecurityAndDate }: PriceLookup) => {
  return (securityId: string, targetDate: string): number | null => {
    const exactPrice = pricesBySecurityAndDate.get(`${securityId}_${targetDate}`);
    if (exactPrice !== undefined) return exactPrice;

    const prices = pricesBySecurity.get(securityId);
    if (!prices || prices.length === 0) return null;

    // Ascending by date: binary-search the latest entry with `date <= targetDate`
    // (gap-day fallback for weekends/holidays/sparse coverage).
    let lo = 0;
    let hi = prices.length - 1;
    let lastValidPrice: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (prices[mid]!.date <= targetDate) {
        lastValidPrice = prices[mid]!.price;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return lastValidPrice;
  };
};
