import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import * as Currencies from '@models/currencies.model';
import * as UsersCurrencies from '@models/users-currencies.model';
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
  const { baseCode, quoteCode, userId, amount, bypassCache = false } = params;

  const dateStr = new Date(params.date).toISOString().split('T')[0]!;

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

    const cacheKey = buildRefAmountCacheKey({
      userId,
      amount,
      baseCode,
      quoteCode: resolvedQuoteCode,
      dateStr,
    });

    if (!bypassCache) {
      const cachedAmount = await refAmountCache.read(cacheKey);

      if (cachedAmount !== null) {
        return Money.fromDecimal(cachedAmount);
      }
    }

    // If baseCode equals the resolved quote currency, no conversion is needed.
    if (resolvedQuoteCode === baseCode) {
      if (!bypassCache) {
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

    const [baseDecimals, quoteDecimals] = await Promise.all([
      getCurrencyDecimals({ userId, code: baseCode }),
      getCurrencyDecimals({ userId, code: resolvedQuoteCode }),
    ]);

    const finalAmount = calculateRefAmountFromParams({ amount, rate: result.rate, baseDecimals, quoteDecimals });

    // Cache the final result as an exact decimal string. Skipped under `bypassCache` (see its doc):
    // a write-back inside an uncommitted rate-write transaction would poison the
    // cache on rollback.
    if (!bypassCache) {
      await refAmountCache.write({ key: cacheKey, value: serializeRefAmountCacheValue({ amount: finalAmount }) });
    }

    return finalAmount;
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') {
      logger.error(e as Error);
    }
    throw e;
  }
}

export { calculateRefAmountFromParams } from './calculate-ref-amount.utils';

type Params = {
  amount: Money;
  userId: number;
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
