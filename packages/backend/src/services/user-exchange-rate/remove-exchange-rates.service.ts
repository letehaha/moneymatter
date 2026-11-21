import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import * as UserExchangeRates from '@models/user-exchange-rates.model';
import { remeasureRefBalances } from '@services/accounts/remeasure-ref-balances';
import { clearRefAmountCache } from '@services/ref-amount-cache';

import { withTransaction } from '../common/with-transaction';
import { assertCurrencyCodesVisible } from '../currencies/assert-currency-codes-visible';
import { findCustomCurrencyCodes } from '../currencies/custom-currency-codes';
import { findCustomCurrencyQuote } from './resolve-custom-pair-rate';
import { revalueAccountsInCurrencies } from './revalue-accounts-in-currencies';

export const removeUserExchangeRates = withTransaction(
  async ({ userId, pairs }: { userId: number; pairs: UserExchangeRates.ExchangeRatePair[] }) => {
    const codes = pairs.flatMap((pair) => [pair.baseCode, pair.quoteCode]);
    await assertCurrencyCodesVisible({ userId, codes });

    // Serializes removals per user, so two requests that each drop one quote cannot together drop the last.
    await connection.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('user-exchange-rates'), :userId)`, {
      replacements: { userId },
    });

    await UserExchangeRates.removeRates({
      userId,
      pairs,
    });

    // A custom currency has no market rate, so its ref amounts exist only while it keeps one of its own.
    for (const code of await findCustomCurrencyCodes({ codes })) {
      if (!(await findCustomCurrencyQuote({ userId, code }))) {
        throw new ValidationError({ message: t({ key: 'currencies.customCurrencyLastRate', variables: { code } }) });
      }
    }

    // Dropping a custom rate reverts this user to market rates — re-anchor the
    // stored spot measures immediately. A per-account remeasure failure (no market
    // rate for the reverted pair yet) keeps that account's stale value rather than
    // rolling back the removal, which committed correctly. Return the counts so the
    // caller can warn the user; the daily sync re-anchors the lagging ones later.
    const remeasure = await remeasureRefBalances({ userId });

    await revalueAccountsInCurrencies({ userId, pairs });
    await clearRefAmountCache({ userId });

    return { remeasure };
  },
);
