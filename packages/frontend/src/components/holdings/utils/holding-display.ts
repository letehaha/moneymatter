import type { HoldingModel } from '@bt/shared/types/investments';
import { differenceInCalendarDays } from 'date-fns';

export type HoldingSortKey = 'symbol' | 'quantity' | 'value' | 'unrealizedGain';

type SortDirection = 'asc' | 'desc';

export const getPrice = (holding: HoldingModel) => {
  if (holding.latestPrice) {
    return Number(holding.latestPrice);
  }
  const quantity = Number(holding.quantity);
  const marketValue = Number(holding.marketValue || 0);
  return quantity > 0 && marketValue > 0 ? marketValue / quantity : 0;
};

// Fixed calendar-day window – wide enough for a weekend plus a market
// holiday and the provider's one-day EOD lag. Per-exchange calendars if it misfires.
const STALE_PRICE_DAYS = 5;

export const isPriceStale = ({ holding, now = new Date() }: { holding: HoldingModel; now?: Date }) =>
  !!holding.priceDate &&
  Number(holding.quantity) !== 0 &&
  differenceInCalendarDays(now, holding.priceDate) > STALE_PRICE_DAYS;

/**
 * A position is "closed" once its quantity reaches zero AND the holding has
 * recorded activity – either a non-zero cost basis (an open partial-fill
 * leftover) or a non-zero realized gain (a completed buy-then-sell cycle).
 *
 * Zero-quantity / zero-cost / zero-realized-gain holdings represent a security
 * that was just added but hasn't received its first transaction yet; those stay
 * out of the closed section so the user can keep building it up.
 */
export const isClosedPosition = (holding: HoldingModel) => {
  if (Number(holding.quantity) !== 0) return false;
  const costBasis = Number(holding.costBasis);
  const realizedGain = Number(holding.realizedGainValue ?? '0');
  return costBasis > 0 || realizedGain !== 0;
};

const getComparableMarketValue = ({ holding }: { holding: HoldingModel }) =>
  Number(holding.displayMarketValue ?? holding.refMarketValue ?? holding.marketValue ?? 0);

const compareHoldings = ({
  a,
  b,
  sortKey,
  sortDir,
}: {
  a: HoldingModel;
  b: HoldingModel;
  sortKey: HoldingSortKey;
  sortDir: SortDirection;
}) => {
  let av: string | number;
  let bv: string | number;

  switch (sortKey) {
    case 'symbol':
      av = a.security?.symbol ?? '';
      bv = b.security?.symbol ?? '';
      break;
    case 'quantity':
      av = Number(a.quantity);
      bv = Number(b.quantity);
      break;
    case 'value':
      av = getComparableMarketValue({ holding: a });
      bv = getComparableMarketValue({ holding: b });
      break;
    case 'unrealizedGain':
      av = Number(a.unrealizedGainValue || 0);
      bv = Number(b.unrealizedGainValue || 0);
      break;
  }

  if (typeof av === 'string') av = av.toLocaleLowerCase();
  if (typeof bv === 'string') bv = bv.toLocaleLowerCase();
  return sortDir === 'asc' ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
};

export const sortHoldings = ({
  holdings,
  sortKey,
  sortDir,
}: {
  holdings: HoldingModel[];
  sortKey: HoldingSortKey;
  sortDir: SortDirection;
}) => [...holdings].sort((a, b) => compareHoldings({ a, b, sortKey, sortDir }));

/**
 * Split holdings into three groups – just-added, active, closed – each
 * independently sorted with the same key/direction.
 *
 * The just-added group is for securities the user picked from the Add Symbols
 * dialog during the current session; pinning them at the top lets the user
 * keep adding transactions to a fresh holding without scrolling. Membership
 * is in-memory only and resets on page reload.
 *
 * Closed positions live in their own collapsible section. A just-added id wins
 * over the closed classification – even a zero-everything holding stays in the
 * just-added bucket while the session remembers it.
 */
export const groupHoldings = ({
  holdings,
  sortKey,
  sortDir,
  justAddedIds,
}: {
  holdings: HoldingModel[];
  sortKey: HoldingSortKey;
  sortDir: SortDirection;
  justAddedIds?: ReadonlySet<string>;
}) => {
  const justAdded: HoldingModel[] = [];
  const active: HoldingModel[] = [];
  const closed: HoldingModel[] = [];
  for (const holding of holdings) {
    if (justAddedIds?.has(holding.securityId)) {
      justAdded.push(holding);
    } else if (isClosedPosition(holding)) {
      closed.push(holding);
    } else {
      active.push(holding);
    }
  }
  return {
    justAdded: sortHoldings({ holdings: justAdded, sortKey, sortDir }),
    active: sortHoldings({ holdings: active, sortKey, sortDir }),
    closed: sortHoldings({ holdings: closed, sortKey, sortDir }),
  };
};

// A priced holding with a zero base value means the FX conversion failed, not that it's worthless.
const getBaseMarketValue = ({ holding }: { holding: HoldingModel }) => {
  if (!holding.refMarketValue) return null;
  const value = Number(holding.refMarketValue);
  if (value === 0 && Number(holding.marketValue || 0) > 0) return null;
  return value;
};

/**
 * Share of the portfolio's holdings value, measured in the base currency so mixed-currency holdings compare.
 * Null for a holding without a base-currency value; those stay out of the total.
 */
export const getHoldingWeights = ({ holdings }: { holdings: HoldingModel[] }): Map<string, number | null> => {
  const values = holdings.map((holding) => ({ id: holding.securityId, value: getBaseMarketValue({ holding }) }));
  const total = values.reduce((sum, { value }) => sum + (value ?? 0), 0);
  return new Map(
    values.map(({ id, value }) => {
      if (value === null) return [id, null];
      return [id, total > 0 ? value / total : 0];
    }),
  );
};
