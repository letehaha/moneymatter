import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import * as UserExchangeRates from '@models/user-exchange-rates.model';
import { remeasureRefBalances } from '@services/accounts/remeasure-ref-balances';
import { clearRefAmountCache } from '@services/ref-amount-cache';

import { withTransaction } from '../common/with-transaction';
import { assertCurrencyCodesVisible } from '../currencies/assert-currency-codes-visible';
import { findCustomCurrencyCodes } from '../currencies/custom-currency-codes';
import { planRateChanges, resolveRateChanges } from '../currencies/custom-rate-changes';
import { recomputeCustomRefAmounts } from '../currencies/recompute-custom-ref-amounts.service';
import { assertRemovePairRules } from './exchange-rate-pair-rules';
import { findCustomCurrencyQuote } from './resolve-custom-pair-rate';
import { revalueAccountsInCurrencies } from './revalue-accounts-in-currencies';
import { assertCustomRatesAreManual } from './update-exchange-rates.service';

export const removeUserExchangeRates = withTransaction(
  async ({ userId, pairs }: { userId: number; pairs: UserExchangeRates.ExchangeRatePair[] }) => {
    assertRemovePairRules({ pairs });

    const codes = pairs.flatMap((pair) => [pair.baseCode, pair.quoteCode]);
    await assertCurrencyCodesVisible({ userId, codes, allowedWithoutPlan: codes });

    const customCodes = await findCustomCurrencyCodes({ codes });
    const datedIsoPair = pairs.find(
      (pair) => pair.effectiveDate && !customCodes.has(pair.baseCode) && !customCodes.has(pair.quoteCode),
    );
    if (datedIsoPair) throw UserExchangeRates.datedIsoPairError({ pair: datedIsoPair });

    // A custom currency's rates are removed one day at a time; it always keeps a rate.
    const undatedCode = pairs
      .filter((pair) => !pair.effectiveDate)
      .flatMap((pair) => [pair.baseCode, pair.quoteCode])
      .find((code) => customCodes.has(code));
    if (undatedCode) {
      throw new ValidationError({
        message: t({ key: 'currencies.customCurrencyRemovalNeedsDate', variables: { code: undatedCode } }),
      });
    }

    // Serializes removals and rate source changes per user, so two requests that each drop one rate
    // cannot together drop the last, and the source checked below is the committed one.
    await connection.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('user-exchange-rates'), :userId)`, {
      replacements: { userId },
    });
    await assertCustomRatesAreManual({ userId, customCodes });

    const plannedChanges = await planRateChanges({ userId, pairs, kind: 'remove' });

    await UserExchangeRates.removeRates({
      userId,
      pairs,
    });

    // A custom currency has no market rate, so its ref amounts exist only while it keeps one of its own.
    for (const code of customCodes) {
      if (!(await findCustomCurrencyQuote({ userId, code, date: new Date() }))) {
        throw new ValidationError({ message: t({ key: 'currencies.customCurrencyLastRate', variables: { code } }) });
      }
    }

    // Dropping a custom rate reverts this user to market rates — re-anchor the
    // stored spot measures immediately. A per-account remeasure failure (no market
    // rate for the reverted pair yet) keeps that account's stale value rather than
    // rolling back the removal, which committed correctly. Return the counts so the
    // caller can warn the user; the daily sync re-anchors the lagging ones later.
    const remeasure = await remeasureRefBalances({ userId });

    // Days that fall back to another rate are valued again.
    await recomputeCustomRefAmounts({
      userId,
      changes: await resolveRateChanges({ userId, planned: plannedChanges }),
      remeasureSpot: false,
    });

    await revalueAccountsInCurrencies({ userId, pairs });
    await clearRefAmountCache({ userId });

    return { remeasure };
  },
);
