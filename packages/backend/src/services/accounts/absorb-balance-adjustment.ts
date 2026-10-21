import { ACCOUNT_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import Accounts, * as AccountsModel from '@models/accounts.model';
import Balances from '@models/balances.model';
import { namespace } from '@models/connection';
import { getBaseCurrency } from '@models/users-currencies.model';
import { assertNotDerivedBalanceAccount } from '@services/accounts/derived-balance-guard';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { isRevaluedAccount, scheduleBalanceRevalue } from '@services/balances/revalue-balance-history.service';

import { withTransaction } from '../common/with-transaction';
import { measureSpotRefBalance } from './measure-spot-ref-balance';
import { restampRefInitialBalance } from './restamp-ref-initial-balance';

/**
 * Shift an account's balance by a signed delta while absorbing the same delta
 * into its opening balance, so `currentBalance = initialBalance + Σ(tx)` keeps
 * holding without spawning an adjustment transaction.
 *
 * Only the NATIVE delta is supplied; the ref side is derived, not delta-shifted:
 * `refCurrentBalance` is a spot measure of the shifted native balance at the latest
 * rate, and `refInitialBalance` is restamped at the ledger-boundary rate (which
 * cascades the change into the Balances history). Summing a caller-supplied
 * `refAmountDelta` from historical per-row `refAmount`s instead would keep the
 * opening ref balance a blend of historical rates. A system account held outside its
 * owner's base currency skips the spot pin and is rebuilt at per-day rates instead.
 *
 * Deltas compose: the account row is read under SELECT ... FOR UPDATE, so
 * concurrent absorbs (two imports finalizing into one account, or an import racing
 * a bank sync) serialize and each applies its delta on top of the other's result.
 * An absolute target from a pre-work snapshot would discard a concurrent writer's
 * change.
 *
 * Non-system accounts keep their provider-owned `initialBalance` /
 * `refInitialBalance` untouched; only the current balances move. The returned row
 * is re-read after all derived writes, so its ref fields are current.
 */
export const absorbBalanceAdjustment = withTransaction(
  async ({
    userId,
    accountId,
    amountDelta,
  }: {
    userId: number;
    accountId: string;
    /** Signed shift of `currentBalance`, in the account's own currency. */
    amountDelta: Money;
  }): Promise<Accounts> => {
    const sequelizeTx = namespace.get('transaction');
    const account = await lockAccountRow({ accountId, userId });
    if (!account) {
      throw new ValidationError({ message: `Account with ID ${accountId} not found` });
    }
    assertNotDerivedBalanceAccount({ account, actionPhrase: 'take a balance adjustment' });

    const isSystem = account.type === ACCOUNT_TYPES.system;
    const newCurrentBalance = account.currentBalance.add(amountDelta);
    const refCurrentBalance = await measureSpotRefBalance({
      userId,
      amount: newCurrentBalance,
      baseCode: account.currencyCode,
      site: 'absorbBalanceAdjustment',
    });
    const updated = await AccountsModel.updateAccountById({
      id: accountId,
      userId,
      currentBalance: newCurrentBalance,
      // A missing rate must not abort an import/bank-sync absorb: omit the ref
      // column (the stored value stays) and let the daily remeasure self-heal it.
      // A custom currency without a rate measures as `null`, which is stored.
      ...(refCurrentBalance !== undefined ? { refCurrentBalance } : {}),
      ...(isSystem ? { initialBalance: account.initialBalance.add(amountDelta) } : {}),
    });
    if (!updated) {
      throw new ValidationError({ message: `Account with ID ${accountId} could not be updated` });
    }

    const baseCurrency = isSystem && !amountDelta.isZero() ? await getBaseCurrency({ userId }) : null;
    const revalueOwnsHistory =
      !!baseCurrency && isRevaluedAccount({ account: updated, baseCurrencyCode: baseCurrency.currencyCode });

    let result = updated;
    if (isSystem && !amountDelta.isZero()) {
      // The opening balance moved → re-derive its boundary-rate ref stamp; the
      // restamp cascades the resulting diff into the Balances history rows.
      await restampRefInitialBalance({ accountId });
      const refreshed = await Accounts.findOne({
        where: { id: accountId, userId },
        transaction: sequelizeTx,
      });
      if (refreshed) {
        result = refreshed;
      } else {
        // The row was just updated above, so a miss is an impossible-state
        // (concurrent delete / id drift). Fall back to the pre-restamp `result`
        // row; its `refInitialBalance` may be stale.
        logger.error(
          {
            message:
              'absorbBalanceAdjustment: account re-read after restampRefInitialBalance missed; returning pre-restamp row, refInitialBalance may be stale',
          },
          { code: 'ACCOUNT_ABSORB_REREAD_AFTER_RESTAMP_MISSED', accountId, userId },
        );
      }
    }

    // Today's net-worth row is a stock equal to the spot `refCurrentBalance`. Pin it
    // last, after the restamp cascade shifts today's row by the opening-balance diff,
    // so the spot value survives. A revalued account gets today's row from the rebuild.
    if (revalueOwnsHistory) {
      await scheduleBalanceRevalue({ accountId });
    } else {
      await Balances.setTodayRowToSpot({ account: result });
    }

    return result;
  },
);
