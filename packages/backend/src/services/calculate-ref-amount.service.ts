import { getConversionDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ExchangeRateUnavailableError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import * as Currencies from '@models/currencies.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { findCustomCurrencyCodes, includesCustomCurrencyCode } from '@services/currencies/custom-currency-codes';
import * as userExchangeRateService from '@services/user-exchange-rate';

import { calculateRefAmountFromParams } from './calculate-ref-amount.utils';
import { withTransaction } from './common/with-transaction';
import { buildRefAmountCacheKey, refAmountCache, serializeRefAmountCacheValue } from './ref-amount-cache';

/**
 * Calculates the reference amount for the provided currencies and parameters.
 * If the quote currency code is not provided, the default user currency is used.
 * If the base currency code is the same as the user's default currency or the quote currency, the original amount is returned.
 *
 * @async
 * @export
 * @param {Object} params
 * @param {number} params.amount - The amount to be converted. Amount represents `baseCode` currency.
 * @param {number} params.userId - The ID of the user for whom the exchange rate is to be fetched.
 * @param {string} params.baseCode - The base currency code.
 * @param {string} [params.quoteCode] - The quote currency code (optional, uses user's default currency if not provided).
 * @returns {Promise<number>} The reference amount after conversion, or the original amount if the base currency is the user's default or the same as the quote currency.
 * @throws {Error} Throws an error if the exchange rate cannot be fetched or the transaction fails.
 * @example
 * const refAmount = await calculateRefAmount({ amount: 100, userId: 42, baseCode: 'USD', quoteCode: 'EUR' });
 * const refAmountForDefaultUserCurrency = await calculateRefAmount({ amount: 100, userId: 42, baseCode: 'USD' });
 */
async function calculateRefAmountImpl(params: Params): Promise<Money> {
  const { baseCode, quoteCode, userId, amount, bypassCache = false, amountOwnerUserId } = params;

  const dateStr = new Date(params.date).toISOString().split('T')[0]!;

  let involvesCustomCurrency = false;

  try {
    // Resolve the quote currency BEFORE building the cache key: when `quoteCode` is
    // omitted the result depends on the user's CURRENT default currency, so the key
    // must encode that resolved code. A literal "default" placeholder would collide
    // across a base-currency change and re-serve a stale cross-base value.
    let defaultUserCurrency: Currencies.default | undefined = undefined;

    if (!quoteCode) {
      const result = await UsersCurrencies.getCurrency({
        userId,
        isDefaultCurrency: true,
      });

      if (!result) {
        throw new ValidationError({
          message: t({ key: 'currencies.cannotFindForRefAmount' }),
        });
      }
      defaultUserCurrency = result.currency;
    }

    const resolvedQuoteCode = quoteCode ?? defaultUserCurrency?.code;

    if (!baseCode || !resolvedQuoteCode) {
      throw new ValidationError({
        message: t({ key: 'currencies.cannotCalculateRefAmount' }),
        details: { baseCode, defaultUserCurrency },
      });
    }

    // A custom currency converts at the user's own rate, which can change at any moment and which
    // no edit path invalidates here, so its conversions are never cached.
    involvesCustomCurrency = (await findCustomCurrencyCodes({ codes: [baseCode, resolvedQuoteCode] })).size > 0;
    const useCache = !bypassCache && !involvesCustomCurrency;

    const cacheKey = buildRefAmountCacheKey({
      userId,
      amount,
      baseCode,
      quoteCode: resolvedQuoteCode,
      dateStr,
    });

    if (useCache) {
      const cachedAmount = await refAmountCache.read(cacheKey);

      if (cachedAmount !== null) {
        return Money.fromDecimal(cachedAmount);
      }
    }

    // If baseCode equals the resolved quote currency, no conversion is needed.
    if (resolvedQuoteCode === baseCode) {
      if (useCache) {
        await refAmountCache.write({ key: cacheKey, value: serializeRefAmountCacheValue({ amount }) });
      }
      return amount;
    }

    const result = await userExchangeRateService.getExchangeRate({
      userId,
      date: new Date(params.date),
      baseCode,
      quoteCode: resolvedQuoteCode,
      bypassCache,
    });

    const decimals = await getConversionDecimals({
      userId,
      baseCode,
      quoteCode: resolvedQuoteCode,
      baseOwnerUserId: amountOwnerUserId,
    });

    const finalAmount = calculateRefAmountFromParams({ amount, rate: result.rate, ...decimals });

    // Cache the final result as an exact decimal string. Skipped under `bypassCache` (see its doc):
    // a write-back inside an uncommitted rate-write transaction would poison the
    // cache on rollback.
    if (useCache) {
      await refAmountCache.write({ key: cacheKey, value: serializeRefAmountCacheValue({ amount: finalAmount }) });
    }

    return finalAmount;
  } catch (e) {
    // A custom currency without a rate is an ordinary state the caller turns into a flagged row.
    const isExpectedMiss = involvesCustomCurrency && e instanceof ExchangeRateUnavailableError;
    if (process.env.NODE_ENV !== 'test' && !isExpectedMiss) {
      logger.error(e as Error);
    }
    throw e;
  }
}

export { calculateRefAmountFromParams } from './calculate-ref-amount.utils';

type Params = {
  amount: Money;
  /** User whose base currency and rates drive the conversion. */
  userId: number;
  /**
   * Whose definition of `baseCode` rounds the amount before it converts: the account owner, when
   * a collaborator writes on a shared account. Defaults to `userId`.
   */
  amountOwnerUserId?: number;
  date: Date | string;
  baseCode: string;
  quoteCode?: string;
  /**
   * Skip the redis cache entirely — no read, no write-back — on both this layer and
   * the cross-rate layer inside `getExchangeRate`. Required for balance remeasure
   * inside the custom-rate edit/remove `withTransaction`: it must observe a rate that
   * changed within the cache TTL, and writing the computed amount back before that
   * rate write commits would poison the 1h-TTL cache with a value that may roll back.
   */
  bypassCache?: boolean;
};

export const calculateRefAmount = withTransaction(calculateRefAmountImpl);

/**
 * Like `calculateRefAmount`, but a conversion that involves a custom currency and has no rate
 * answers `null` instead of throwing, so the row can still be saved and flagged `refAmountMissing`.
 * An ISO conversion with no rate keeps throwing: a market rate that is absent is a data problem,
 * while a custom currency simply has no rate until its owner provides one. A zero amount converts to
 * zero without a rate.
 */
export const calculateRefAmountOrNull = async (params: Params): Promise<Money | null> => {
  try {
    return await calculateRefAmount(params);
  } catch (error) {
    if (!(error instanceof ExchangeRateUnavailableError)) throw error;

    const codes = [params.baseCode, params.quoteCode].filter((code): code is string => Boolean(code));
    if (await includesCustomCurrencyCode({ codes })) {
      // Nothing converts to nothing, at any rate: a zero amount never needs one.
      return params.amount.isZero() ? Money.zero() : null;
    }

    throw error;
  }
};
