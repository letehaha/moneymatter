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
import { planRateChanges, resolveRateChanges } from '../currencies/custom-rate-changes';
import { recomputeCustomRefAmounts } from '../currencies/recompute-custom-ref-amounts.service';
import { assertEditPairRules } from './exchange-rate-pair-rules';
import { revalueAccountsInCurrencies } from './revalue-accounts-in-currencies';

/**
 * Writes the dated rates of pairs with a custom side. A custom currency keeps exactly one quote, an
 * ISO currency the user holds: rates in another quote are dropped, and the dated rates of the same
 * quote stay. Written directly: `updateRates` would also switch live rates off on the ISO side.
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

  for (const quoteCode of new Set(quoteByCustomCode.values())) await resolveRateQuoteCode({ userId, quoteCode });

  // The lock the removal takes, so a concurrent removal cannot drop the rows written here.
  await connection.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('user-exchange-rates'), :userId)`, {
    replacements: { userId },
  });

  for (const [code, quoteCode] of quoteByCustomCode) {
    await UserExchangeRates.default.destroy({
      where: {
        userId,
        [Op.or]: [
          { baseCode: code, quoteCode: { [Op.ne]: quoteCode } },
          { quoteCode: code, baseCode: { [Op.ne]: quoteCode } },
        ],
      },
    });
  }

  // A repeated pair and day would write the same row twice; the last one wins.
  const uniquePairs = new Map(
    pairs.map((pair) => [`${pair.baseCode}>${pair.quoteCode}>${pair.effectiveDate ?? ''}`, pair]),
  );

  const written: UserExchangeRates.default[] = [];
  for (const pairItem of uniquePairs.values()) {
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
