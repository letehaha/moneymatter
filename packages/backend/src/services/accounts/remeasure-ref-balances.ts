import { RefBalanceRemeasureResult } from '@bt/shared/types';
import { Money, moneyEqualsOrNull } from '@common/types/money';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import { namespace } from '@models/connection';
import { calculateRefAmountOrNull } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { DatabaseError } from 'sequelize';

/**
 * Re-measures one account's spot `ref*` balances at the latest rate and pins
 * today's net-worth row to match. Returns `'updated'` when the values moved,
 * `'skipped'` when already current.
 *
 * `withTransaction` commits the account row and today's `Balances` row together.
 * On the cron there is no ambient transaction, so it opens its own per-account
 * one — a failed conversion rolls back both writes without holding locks across
 * other accounts. Inside the custom-rate edit/remove flow it reuses the ambient
 * transaction so the reads observe that flow's still-uncommitted rate write.
 */
const remeasureAccountRefBalances = withTransaction(
  async ({ account }: { account: Accounts }): Promise<'skipped' | 'updated'> => {
    // A custom currency without a rate measures as `null` (not yet valued) instead of failing the sweep.
    const refCurrentBalance = await calculateRefAmountOrNull({
      // Account owner, not the caller: ref balances live in the OWNER's base
      // currency and rate resolution (connected-currency, custom rates) runs
      // against the owner.
      userId: account.userId,
      amount: account.currentBalance,
      baseCode: account.currencyCode,
      date: new Date(),
      bypassCache: true,
    });
    const refCreditLimit = account.creditLimit.isZero()
      ? Money.zero()
      : await calculateRefAmountOrNull({
          userId: account.userId,
          amount: account.creditLimit,
          baseCode: account.currencyCode,
          date: new Date(),
          bypassCache: true,
        });

    if (
      moneyEqualsOrNull(refCurrentBalance, account.refCurrentBalance) &&
      moneyEqualsOrNull(refCreditLimit, account.refCreditLimit)
    ) {
      return 'skipped';
    }

    await Accounts.update({ refCurrentBalance, refCreditLimit }, { where: { id: account.id } });

    // The chart's today point is a stock too: pin today's net-worth row to the
    // freshly measured spot value.
    account.refCurrentBalance = refCurrentBalance;
    await Balances.setTodayRowToSpot({ account });
    return 'updated';
  },
);

/**
 * Re-anchors the base-currency (`ref*`) side of account balances to the latest
 * exchange rate. `refCurrentBalance` and `refCreditLimit` are spot measures (the
 * native value at the current rate), not accumulators of per-transaction
 * conversions — without re-anchoring, a rate move leaves them at a blend of
 * historical rates (an account drained to zero would keep a nonzero ref residue).
 *
 * Runs after every rate sync (all accounts) and after a user edits/removes a
 * custom rate (their accounts only). Each account is re-measured independently;
 * a per-account failure is counted and logged so the rest still proceed.
 *
 * The per-account catch is asymmetric: on the custom-rate path a `DatabaseError`
 * has aborted the ambient transaction, so it's re-thrown to roll the request back
 * rather than let the endpoint's COMMIT-turned-ROLLBACK drop the rate write
 * silently. On the cron each account owns an already-rolled-back transaction, so
 * it counts-and-continues. The designed missing-rate error is not a
 * `DatabaseError`, so it always counts-and-continues.
 */
export async function remeasureRefBalances({
  userId,
  currencyCodes,
}: {
  userId?: number;
  /** Narrows the sweep to accounts held in these currencies. */
  currencyCodes?: string[];
} = {}): Promise<RefBalanceRemeasureResult> {
  const accounts = await Accounts.findAll({
    where: {
      ...(userId === undefined ? {} : { userId }),
      ...(currencyCodes ? { currencyCode: currencyCodes } : {}),
    },
  });

  // Ambient transaction here means the caller (custom-rate edit/remove) wraps the
  // whole sweep, so a DB abort below would poison it. On the cron there is none.
  const ambientTransaction = namespace.get('transaction');
  const hasAmbientTransaction = !!ambientTransaction && !ambientTransaction.finished;

  // The all-users cron sweep skips users mid-base-currency-migration — the recalc
  // owns those ref* amounts. isBaseCurrencyChangeLocked is a sub-ms Redis GET, so
  // it re-checks per account; targeted per-user calls are guarded at their route.
  const isGlobalSweep = userId === undefined;

  let updated = 0;
  let failed = 0;

  for (const account of accounts) {
    if (isGlobalSweep && (await isBaseCurrencyChangeLocked({ userId: account.userId }))) {
      continue;
    }

    try {
      const status = await remeasureAccountRefBalances({ account });
      if (status === 'updated') updated += 1;
    } catch (e) {
      // A DB error inside the caller's ambient transaction has already aborted it;
      // re-throw so the whole request rolls back instead of counting phantom
      // "transaction is aborted" failures and dropping the rate write silently.
      if (hasAmbientTransaction && e instanceof DatabaseError) {
        throw e;
      }

      // A single account with an unavailable rate (exotic currency, provider gap)
      // must not block the rest — its previous ref values stay until a later run.
      failed += 1;
      logger.error(
        {
          message: 'Failed to remeasure ref balances for account; previous values kept',
          error: e as Error,
        },
        { code: 'ACCOUNT_REF_REMEASURE_FAILED', accountId: account.id, userId: account.userId },
      );
    }
  }

  return { updated, failed };
}
