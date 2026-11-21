import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import * as UserExchangeRates from '@models/user-exchange-rates.model';
import { remeasureRefBalances } from '@services/accounts/remeasure-ref-balances';
import { clearRefAmountCache } from '@services/ref-amount-cache';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { assertCurrencyCodesVisible } from '../currencies/assert-currency-codes-visible';
import { resolveRateQuoteCode } from '../currencies/custom-currencies.service';
import { findCustomCurrencyCodes } from '../currencies/custom-currency-codes';
import { revalueAccountsInCurrencies } from './revalue-accounts-in-currencies';

/**
 * A custom currency keeps exactly one ISO quote, so its pairs replace every stored row of the code.
 * Written directly: `updateRates` would also switch live rates off on the ISO side.
 */
const replaceCustomRates = async ({
  userId,
  pairs,
  customCodes,
}: {
  userId: number;
  pairs: UserExchangeRates.UpdateExchangeRatePair[];
  customCodes: Set<string>;
}) => {
  const quoteByCustomCode = new Map<string, string>();

  for (const pair of pairs) {
    const [code, quoteCode] = customCodes.has(pair.baseCode)
      ? [pair.baseCode, pair.quoteCode]
      : [pair.quoteCode, pair.baseCode];
    const known = quoteByCustomCode.get(code);

    if (known !== undefined && known !== quoteCode) {
      throw new ValidationError({
        message: t({ key: 'currencies.customCurrencyOneQuote', variables: { code } }),
      });
    }
    quoteByCustomCode.set(code, quoteCode);
  }

  // Same quote rule as at create: an ISO currency the user holds.
  for (const quoteCode of new Set(quoteByCustomCode.values())) await resolveRateQuoteCode({ userId, quoteCode });

  // The lock the removal takes, so a concurrent removal cannot drop the rows written here.
  await connection.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('user-exchange-rates'), :userId)`, {
    replacements: { userId },
  });

  const codes = [...quoteByCustomCode.keys()];
  await UserExchangeRates.default.destroy({
    where: { userId, [Op.or]: [{ baseCode: { [Op.in]: codes } }, { quoteCode: { [Op.in]: codes } }] },
  });

  // A repeated pair would collide on the primary key in one batch; the last one wins.
  const uniquePairs = new Map(pairs.map((pair) => [`${pair.baseCode}>${pair.quoteCode}`, pair]));

  return UserExchangeRates.default.bulkCreate(
    [...uniquePairs.values()].map(({ baseCode, quoteCode, rate }) => ({ userId, baseCode, quoteCode, rate })),
    { returning: true },
  );
};

export const editUserExchangeRates = withTransaction(
  async ({ userId, pairs }: { userId: number; pairs: UserExchangeRates.UpdateExchangeRatePair[] }) => {
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

    const isCustomPair = (pair: UserExchangeRates.UpdateExchangeRatePair) =>
      customCodes.has(pair.baseCode) || customCodes.has(pair.quoteCode);
    const customPairs = pairs.filter(isCustomPair);
    const isoPairs = pairs.filter((pair) => !isCustomPair(pair));

    const rates = [
      ...(customPairs.length ? await replaceCustomRates({ userId, pairs: customPairs, customCodes }) : []),
      ...(isoPairs.length ? await UserExchangeRates.updateRates({ userId, pairs: isoPairs }) : []),
    ];

    // A custom rate changes what this user's balances are worth in base currency —
    // the stored spot measures must observe it immediately. A per-account remeasure
    // failure (no market rate for the pair yet) must NOT throw: the rate write above
    // committed and throwing would roll it back. Return the counts so the caller can
    // warn the user; the daily sync re-anchors the lagging ones later.
    const remeasure = await remeasureRefBalances({ userId });

    await revalueAccountsInCurrencies({ userId, pairs });
    await clearRefAmountCache({ userId });

    return { rates, remeasure };
  },
);
