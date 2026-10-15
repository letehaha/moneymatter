import { INVESTMENT_TRANSACTION_CATEGORY, isCashInCategory } from '@bt/shared/types/investments';
import { ValidationError } from '@js/errors';
import { Big } from 'big.js';

const DECIMAL_SCALE = 10;

const NO_CASH_CATEGORIES: INVESTMENT_TRANSACTION_CATEGORY[] = [
  INVESTMENT_TRANSACTION_CATEGORY.transfer,
  INVESTMENT_TRANSACTION_CATEGORY.cancel,
  INVESTMENT_TRANSACTION_CATEGORY.other,
];

interface ResolvedSettlement {
  /** Fee in the security's currency (settlementFees converted at settlementRate). */
  fees: string;
  /**
   * Cash moved in the security's currency: buy/fee/tax — `quantity * price + fees`;
   * sell/dividend — `quantity * price - fees`.
   */
  amount: string;
  settlementCurrencyCode: string;
  /**
   * Absolute cash moved in the settlement currency: buy/fee/tax — paid
   * including fee; sell/dividend — received net of fee.
   */
  settlementAmount: string;
  /** Fee in the settlement currency. */
  settlementFees: string;
  /** Settlement currency units per 1 security currency unit. */
  settlementRate: string;
}

interface ResolveSettlementParams {
  category: INVESTMENT_TRANSACTION_CATEGORY;
  quantity: string;
  price: string;
  /** Fee in the security's currency; used only when no settlement leg is supplied. */
  fees: string;
  holdingCurrencyCode: string;
  settlementCurrencyCode?: string;
  settlementAmount?: string;
  settlementFees?: string;
  /**
   * Known security→settlement rate: the user read it off the broker statement,
   * or the service injected the market rate because neither fee nor rate was
   * supplied. The fee is then derived as the residual between the cash moved
   * and `quantity × price × rate`. Mutually exclusive with settlementFees.
   */
  settlementRate?: string;
  /**
   * Reuse this security→settlement rate instead of deriving one from
   * settlementAmount. Update flow: when quantity/price change but the user
   * didn't re-enter the cash amount, the broker's conversion rate is the part
   * that stays true, so settlementAmount is recomputed from it.
   */
  fixedRate?: string;
}

/**
 * Resolves both currency legs of an investment transaction.
 *
 * A trade quotes price/quantity in the security's currency, but cash can
 * settle in a different one (single-cash-currency brokers, e.g. a PLN account
 * trading USD securities). The user supplies what they know — price per share
 * plus the actual cash moved (and the broker's explicit fee) — and this
 * function derives the rest:
 *
 * - same currency, settlementAmount given: fee = residual between cash moved
 *   and quantity × price (exact, no rate involved)
 * - cross currency, fee known: the broker's effective conversion rate is
 *   implied: rate = (cash moved net of fee) / (quantity × price); the fee
 *   converts to the security currency at that same rate
 * - cross currency, rate known (user-entered or market): the fee is the
 *   residual between the cash moved and `quantity × price × rate`; a negative
 *   residual means the rate was inaccurate, not a real negative fee — the fee
 *   is recorded as 0 and the difference folds into the rate
 * - no settlement leg: cash settled in the security's currency at rate 1
 */
export function resolveSettlement(params: ResolveSettlementParams): ResolvedSettlement {
  const { category, quantity, price, fees, holdingCurrencyCode, settlementAmount, settlementFees, fixedRate } = params;

  const settlementCurrencyCode = params.settlementCurrencyCode ?? holdingCurrencyCode;
  const notional = new Big(quantity || '0').times(new Big(price || '0'));
  const isCashIn = isCashInCategory({ category });

  if (settlementAmount !== undefined && NO_CASH_CATEGORIES.includes(category)) {
    throw new ValidationError({
      message: `Settlement amount is not supported for the '${category}' category — it has no cash impact.`,
    });
  }

  if (settlementCurrencyCode === holdingCurrencyCode) {
    let resolvedFees: Big;

    if (settlementAmount !== undefined) {
      if (settlementFees !== undefined) {
        throw new ValidationError({
          message:
            'For settlement in the security currency omit settlementFees — the fee is derived as the difference between settlementAmount and quantity × price.',
        });
      }
      resolvedFees = isCashIn ? notional.minus(new Big(settlementAmount)) : new Big(settlementAmount).minus(notional);
      if (resolvedFees.lt(0)) {
        throw new ValidationError({
          message: isCashIn
            ? `Cash received (${settlementAmount}) exceeds quantity × price (${notional.toFixed(DECIMAL_SCALE)}) — a negative fee makes no sense. Check the price or the amount.`
            : `Cash spent (${settlementAmount}) is below quantity × price (${notional.toFixed(DECIMAL_SCALE)}) — a negative fee makes no sense. Check the price or the amount.`,
        });
      }
    } else {
      resolvedFees = new Big(fees || '0');
    }

    const feesStr = resolvedFees.toFixed(DECIMAL_SCALE);
    const cashMoved = isCashIn ? notional.minus(resolvedFees) : notional.plus(resolvedFees);
    if (cashMoved.lt(0)) {
      throw new ValidationError({
        message: `Fees (${feesStr}) exceed quantity × price (${notional.toFixed(DECIMAL_SCALE)}) — the cash received would be negative.`,
      });
    }

    return {
      fees: feesStr,
      amount: cashMoved.toFixed(DECIMAL_SCALE),
      settlementCurrencyCode,
      settlementAmount: cashMoved.toFixed(DECIMAL_SCALE),
      settlementFees: feesStr,
      settlementRate: '1',
    };
  }

  // Cross-currency leg
  if (notional.lte(0)) {
    throw new ValidationError({
      message: 'Price and quantity must be positive to settle in a different currency.',
    });
  }

  let rate: Big;
  let cashMoved: Big;
  let feesInSettlement: Big;

  if (settlementAmount === undefined) {
    // Update path: caller skipped the cash field, so we keep the known rate
    // and recompute the cash from the edited quantity/price/fee.
    const knownRate = params.settlementRate ?? fixedRate;
    if (knownRate === undefined) {
      throw new ValidationError({
        message: 'settlementAmount is required when the settlement currency differs from the security currency.',
      });
    }
    rate = new Big(knownRate);
    feesInSettlement = new Big(settlementFees ?? '0');
    const gross = notional.times(rate);
    cashMoved = isCashIn ? gross.minus(feesInSettlement) : gross.plus(feesInSettlement);
  } else if (params.settlementRate !== undefined) {
    if (settlementFees !== undefined) {
      throw new ValidationError({
        message:
          'Provide either settlementFees or settlementRate, not both — one is always derived from the other and the cash moved.',
      });
    }
    rate = new Big(params.settlementRate);
    if (rate.lte(0)) {
      throw new ValidationError({
        message: 'settlementRate must be positive.',
      });
    }
    cashMoved = new Big(settlementAmount);
    const gross = notional.times(rate);
    feesInSettlement = isCashIn ? gross.minus(cashMoved) : cashMoved.minus(gross);
    if (feesInSettlement.lt(0)) {
      // The broker's effective rate beat the provided one — the residual is
      // rate inaccuracy, not a real negative fee. Record zero fee and fold the
      // difference into the rate.
      feesInSettlement = new Big(0);
      rate = cashMoved.div(notional);
    }
  } else if (settlementFees !== undefined) {
    cashMoved = new Big(settlementAmount);
    feesInSettlement = new Big(settlementFees);
    const gross = isCashIn ? cashMoved.plus(feesInSettlement) : cashMoved.minus(feesInSettlement);
    if (gross.lte(0)) {
      throw new ValidationError({
        message: `Cash moved (${settlementAmount}) minus fees (${settlementFees}) must be positive — cannot derive the conversion rate.`,
      });
    }
    rate = gross.div(notional);
  } else {
    throw new ValidationError({
      message:
        'Provide settlementFees or settlementRate when the settlement currency differs from the security currency (0 fee is allowed).',
    });
  }

  if (rate.lte(0) || cashMoved.lt(0)) {
    throw new ValidationError({
      message: 'Settlement values produce a non-positive conversion rate. Check the amounts.',
    });
  }

  const resolvedFees = feesInSettlement.div(rate);

  return {
    fees: resolvedFees.toFixed(DECIMAL_SCALE),
    amount: (isCashIn ? notional.minus(resolvedFees) : notional.plus(resolvedFees)).toFixed(DECIMAL_SCALE),
    settlementCurrencyCode,
    settlementAmount: cashMoved.toFixed(DECIMAL_SCALE),
    settlementFees: feesInSettlement.toFixed(DECIMAL_SCALE),
    settlementRate: rate.toFixed(DECIMAL_SCALE),
  };
}
