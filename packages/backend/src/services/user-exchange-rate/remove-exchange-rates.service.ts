import * as UserExchangeRates from '@models/user-exchange-rates.model';
import { remeasureRefBalances } from '@services/accounts/remeasure-ref-balances';
import { clearRefAmountCache } from '@services/ref-amount-cache';

import { withTransaction } from '../common/with-transaction';
import { revalueAccountsInCurrencies } from './revalue-accounts-in-currencies';

export const removeUserExchangeRates = withTransaction(
  async ({ userId, pairs }: { userId: number; pairs: UserExchangeRates.ExchangeRatePair[] }) => {
    await UserExchangeRates.removeRates({
      userId,
      pairs,
    });

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
