import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import * as UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { remeasureRefBalances } from '@services/accounts/remeasure-ref-balances';
import { clearRefAmountCache } from '@services/ref-amount-cache';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { assertCurrencyCodesVisible } from '../currencies/assert-currency-codes-visible';
import { resolveRateQuoteCode } from '../currencies/custom-currencies.service';
import { findCustomCurrencyCodes } from '../currencies/custom-currency-codes';
import { planRateChanges, resolveRateChanges } from '../currencies/custom-rate-changes';
import { recomputeCustomRefAmounts } from '../currencies/recompute-custom-ref-amounts.service';
import { assertEditPairRules } from './exchange-rate-pair-rules';
import { revalueAccountsInCurrencies } from './revalue-accounts-in-currencies';

/**
 * Only a custom currency on manual rates takes the user's own rates: a peg or a synced source prices
 * the others. ISO currencies are not checked.
 */
export const assertCustomRatesAreManual = async ({
  userId,
  customCodes,
}: {
  userId: number;
  customCodes: Set<string>;
}): Promise<void> => {
  if (!customCodes.size) return;

  const held = await UsersCurrencies.findOne({
    where: { userId, currencyCode: { [Op.in]: [...customCodes] }, rateSource: { [Op.ne]: 'manual' } },
    attributes: ['currencyCode'],
    raw: true,
  });
  if (held) {
    throw new ValidationError({
      message: t({ key: 'currencies.customCurrencyRateNotManual', variables: { code: held.currencyCode } }),
    });
  }
};

/**
 * Writes the dated rates of pairs with a custom side. A custom currency holds one rate per day in an
 * ISO currency the user holds: a rate replaces whatever that day held, in any quote, and leaves the
 * other days alone. Only the custom-to-ISO direction is stored; the other one is its inverse. Written
 * directly: `updateRates` would also switch live rates off on the ISO side.
 */
const writeCustomRates = async ({
  userId,
  pairs,
  customCodes,
}: {
  userId: number;
  pairs: UserExchangeRates.UpdateExchangeRatePair[];
  customCodes: Set<string>;
}) => {
  const today = UserExchangeRates.toEffectiveDate({ date: new Date() });
  const rateByDay = new Map<string, UserExchangeRates.UpdateExchangeRatePair & { effectiveDate: string }>();

  for (const pair of pairs.filter((item) => customCodes.has(item.baseCode))) {
    const effectiveDate = pair.effectiveDate ?? today;
    const key = `${pair.baseCode}>${effectiveDate}`;
    const known = rateByDay.get(key);

    if (known && known.quoteCode !== pair.quoteCode) {
      throw new ValidationError({
        message: t({ key: 'currencies.customCurrencyOneQuote', variables: { code: pair.baseCode } }),
      });
    }
    rateByDay.set(key, { ...pair, effectiveDate });
  }

  for (const quoteCode of new Set([...rateByDay.values()].map((pair) => pair.quoteCode))) {
    await resolveRateQuoteCode({ userId, quoteCode });
  }

  const written: UserExchangeRates.default[] = [];
  for (const pairItem of rateByDay.values()) {
    await UserExchangeRates.default.destroy({
      where: {
        userId,
        baseCode: pairItem.baseCode,
        effectiveDate: pairItem.effectiveDate,
        quoteCode: { [Op.ne]: pairItem.quoteCode },
      },
    });
    written.push(await UserExchangeRates.writeDatedRate({ userId, pairItem }));
  }

  return written;
};

export const editUserExchangeRates = withTransaction(
  async ({ userId, pairs }: { userId: number; pairs: UserExchangeRates.UpdateExchangeRatePair[] }) => {
    assertEditPairRules({ pairs });

    const codes = pairs.flatMap((pair) => [pair.baseCode, pair.quoteCode]);
    await assertCurrencyCodesVisible({ userId, codes, allowedWithoutPlan: codes });

    const customCodes = await findCustomCurrencyCodes({ codes });
    const customPair = pairs.find((pair) => customCodes.has(pair.baseCode) && customCodes.has(pair.quoteCode));
    if (customPair) {
      throw new ValidationError({
        message: t({
          key: 'currencies.customCurrencyRateBetweenCustom',
          variables: { baseCode: customPair.baseCode, quoteCode: customPair.quoteCode },
        }),
      });
    }

    // The lock rate removals and rate source changes take, so the source checked here stays in force
    // and a concurrent removal cannot drop the rows written below.
    if (customCodes.size) {
      await connection.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('user-exchange-rates'), :userId)`, {
        replacements: { userId },
      });
    }
    await assertCustomRatesAreManual({ userId, customCodes });

    const isCustomPair = (pair: UserExchangeRates.UpdateExchangeRatePair) =>
      customCodes.has(pair.baseCode) || customCodes.has(pair.quoteCode);
    const customPairs = pairs.filter(isCustomPair);
    const isoPairs = pairs.filter((pair) => !isCustomPair(pair));

    const plannedChanges = await planRateChanges({ userId, pairs, kind: 'edit' });

    const rates = [
      ...(customPairs.length ? await writeCustomRates({ userId, pairs: customPairs, customCodes }) : []),
      ...(isoPairs.length ? await UserExchangeRates.updateRates({ userId, pairs: isoPairs }) : []),
    ];

    // A custom rate changes what this user's balances are worth in base currency —
    // the stored spot measures must observe it immediately. A per-account remeasure
    // failure (no market rate for the pair yet) must NOT throw: the rate write above
    // committed and throwing would roll it back. Return the counts so the caller can
    // warn the user; the daily sync re-anchors the lagging ones later.
    const remeasure = await remeasureRefBalances({ userId });

    // Saved rows in a custom currency follow a rate that changed for days they were valued on.
    await recomputeCustomRefAmounts({
      userId,
      changes: await resolveRateChanges({ userId, planned: plannedChanges }),
      remeasureSpot: false,
    });

    await revalueAccountsInCurrencies({ userId, pairs });
    await clearRefAmountCache({ userId });

    return { rates, remeasure };
  },
);
