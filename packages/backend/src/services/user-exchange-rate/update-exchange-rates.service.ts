import * as UserExchangeRates from '@models/user-exchange-rates.model';
import { remeasureRefBalances } from '@services/accounts/remeasure-ref-balances';

import { withTransaction } from '../common/with-transaction';
import { assertCurrencyCodesVisible } from '../currencies/assert-currency-codes-visible';
import { planRateChanges, resolveRateChanges } from '../currencies/custom-rate-changes';
import { recomputeCustomRefAmounts } from '../currencies/recompute-custom-ref-amounts.service';
import { revalueAccountsInCurrencies } from './revalue-accounts-in-currencies';

export const editUserExchangeRates = withTransaction(
  async ({ userId, pairs }: { userId: number; pairs: UserExchangeRates.UpdateExchangeRatePair[] }) => {
    await assertCurrencyCodesVisible({
      userId,
      codes: pairs.flatMap((pair) => [pair.baseCode, pair.quoteCode]),
    });

    const plannedChanges = await planRateChanges({ userId, pairs, kind: 'edit' });

    const rates = await UserExchangeRates.updateRates({
      userId,
      pairs,
    });

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

    return { rates, remeasure };
  },
);
