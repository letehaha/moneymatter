import * as UserExchangeRates from '@models/user-exchange-rates.model';
import { remeasureRefBalances } from '@services/accounts/remeasure-ref-balances';

import { withTransaction } from '../common/with-transaction';
import { planRateChanges, resolveRateChanges } from '../currencies/custom-rate-changes';
import { recomputeCustomRefAmounts } from '../currencies/recompute-custom-ref-amounts.service';
import { assertRemovePairRules } from './exchange-rate-pair-rules';
import { revalueAccountsInCurrencies } from './revalue-accounts-in-currencies';

export const removeUserExchangeRates = withTransaction(
  async ({ userId, pairs }: { userId: number; pairs: UserExchangeRates.ExchangeRatePair[] }) => {
    assertRemovePairRules({ pairs });

    const plannedChanges = await planRateChanges({ userId, pairs, kind: 'remove' });

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

    // Days that fall back to an earlier rate (or to none) are valued again.
    await recomputeCustomRefAmounts({
      userId,
      changes: await resolveRateChanges({ userId, planned: plannedChanges }),
      remeasureSpot: false,
    });

    await revalueAccountsInCurrencies({ userId, pairs });

    return { remeasure };
  },
);
