import type { SecuritySearchResultFormatted } from '@bt/shared/types/investments';
import { SecuritySearchResultSchema } from '@controllers/investments/holdings/schemas';
import type Holdings from '@models/investments/holdings.model';
import type SecurityPricing from '@models/investments/security-pricing.model';

/**
 * A new holding as an assistant reads it: the ids and the position, without the deprecated
 * `value` and `refValue` columns or the audit timestamps.
 */
export function presentHolding({ holding }: { holding: Holdings }) {
  return {
    portfolioId: holding.portfolioId,
    securityId: holding.securityId,
    currencyCode: holding.currencyCode,
    quantity: holding.quantity,
    costBasis: holding.costBasis,
    refCostBasis: holding.refCostBasis,
  };
}

/** One stored price: the day, the close and where it came from. The row id and audit timestamps stay out. */
export function presentSecurityPrice({ price }: { price: SecurityPricing }) {
  return {
    date: price.date,
    priceClose: price.priceClose,
    priceAsOf: price.priceAsOf,
    source: price.source,
  };
}

const SEARCH_RESULT_KEYS = Object.keys(SecuritySearchResultSchema.shape);

/**
 * A search hit as `create_holding` takes it as `searchResult`: every field of the REST search result
 * schema the provider set, plus `isInPortfolio` when the search was scoped to a portfolio. A key the
 * provider left null or unset is omitted, since the schema takes absent keys but not null for most.
 * `securityId` is added when the hit is already a stored security; the schema drops it, so the result
 * still goes to `create_holding` unchanged.
 */
export function presentSecuritySearchResult({
  result,
  securityId,
}: {
  result: SecuritySearchResultFormatted;
  /** The id of the security already stored for this hit, when there is one. */
  securityId?: string | null;
}) {
  const presented: Record<string, unknown> = {};
  for (const key of [...SEARCH_RESULT_KEYS, 'isInPortfolio'] as (keyof SecuritySearchResultFormatted)[]) {
    const value = result[key];
    if (value !== null && value !== undefined) presented[key] = value;
  }
  if (securityId) presented.securityId = securityId;
  return presented;
}
