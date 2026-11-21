import { roundToCurrency } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { startOfDay } from 'date-fns';

/**
 * Authoritative balance writer for bank-data-provider accounts.
 *
 * Writes the bank's current balance to (a) `Accounts.currentBalance`,
 * (b) `Accounts.refCurrentBalance` and `refCreditLimit` (spot measures at the
 * latest rate, cache bypassed so both share one rate), and (c) a `Balances`
 * snapshot for today (overwrites today's row via the race-safe
 * `INSERT ... ON CONFLICT` path).
 *
 * Per-tx Balances backfill for historical days happens separately, inside
 * `Transactions.@AfterCreate` → `Balances.handleTransactionChange` — see the
 * two-layer design note at the top of that switch. This helper is the
 * authoritative "today" layer; the per-tx hook fills the in-between days that
 * a transaction window touches.
 *
 * PRECONDITION: `balance` MUST be denominated in `account.currencyCode`.
 * Helper does not validate — providers are responsible.
 */
export async function writeBankBalanceWithHistory({
  account,
  balance: providerBalance,
}: {
  account: Accounts;
  balance: Money;
}): Promise<void> {
  const today = startOfDay(new Date());

  const balance = await roundToCurrency({
    money: providerBalance,
    userId: account.userId,
    currencyCode: account.currencyCode,
    mode: 'half-up',
  });

  // The caller's instance can be stale: sync-created transactions and concurrent
  // account edits change the row behind it, so read the live values separately.
  const committed = await Accounts.findByPk(account.id, { attributes: ['id', 'currentBalance', 'creditLimit'] });
  const creditLimit = committed?.creditLimit ?? account.creditLimit;

  const measureSpot = ({ amount }: { amount: Money }) =>
    calculateRefAmount({
      amount,
      userId: account.userId,
      definitionOwnerUserId: account.userId,
      date: today,
      baseCode: account.currencyCode,
      bypassCache: true,
    });
  const refBalance = await measureSpot({ amount: balance });
  const refCreditLimit = creditLimit.isZero() ? Money.zero() : await measureSpot({ amount: creditLimit });

  const previousCents = committed?.currentBalance?.toCents() ?? null;
  const newCents = balance.toCents();
  const signFlipped =
    previousCents !== null && previousCents !== 0 && newCents !== 0 && previousCents > 0 !== newCents > 0;

  // Providers hand us balances with unverified signs; this log makes a wrong
  // sign traceable in production logs.
  logger.info('[balance-diag] Bank balance write', {
    accountId: account.id,
    userId: account.userId,
    accountType: account.type,
    connectionId: account.bankDataProviderConnectionId ?? null,
    currency: account.currencyCode,
    previousCents,
    newCents,
    refCents: refBalance.toCents(),
    signFlipped,
    newIsNegative: newCents < 0,
  });

  await account.update({
    currentBalance: balance,
    refCurrentBalance: refBalance,
    refCreditLimit,
  });

  await Balances.updateAccountBalance({
    accountId: account.id,
    date: today,
    refBalance,
  });
}
