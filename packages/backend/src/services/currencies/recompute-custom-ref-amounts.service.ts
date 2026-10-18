import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { Money, moneyEqualsOrNull } from '@common/types/money';
import Accounts from '@models/accounts.model';
import TransactionSplits from '@models/transaction-splits.model';
import { findTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { remeasureRefBalances } from '@services/accounts/remeasure-ref-balances';
import { restampRefInitialBalance } from '@services/accounts/restamp-ref-initial-balance';
import { scheduleBalanceRevalue } from '@services/balances/revalue-balance-history.service';
import { calculateRefAmountOrNull } from '@services/calculate-ref-amount.service';
import { clearUserRefAmountCacheAfterCommit } from '@services/clear-ref-amount-cache';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { findCustomCurrencyCodes } from './custom-currency-codes';
import { loadDependencyEdges } from './load-dependency-edges';
import {
  type CustomRateChange,
  type RateInterval,
  buildRowSelectors,
  buildScope,
  expandScope,
  matchesRowSelectors,
  selectorEnvelope,
} from './recompute-scope';

interface RecomputeResult {
  /** Custom currencies valued again: the changed ones plus everything priced through them. */
  currencyCodes: string[];
  transactionsUpdated: number;
  splitsUpdated: number;
  accountsRestamped: number;
}

const EMPTY_RESULT: RecomputeResult = {
  currencyCodes: [],
  transactionsUpdated: 0,
  splitsUpdated: 0,
  accountsRestamped: 0,
};

/**
 * Transfer legs whose base-currency amount is anchored to the other leg instead of a rate: a leg in
 * a custom currency whose counterpart (same author) is in the base currency takes the counterpart's
 * amount, so a rate change does not move it.
 */
const findAnchoredTransferIds = async ({
  userId,
  baseCurrencyCode,
  transactions,
}: {
  userId: number;
  baseCurrencyCode: string;
  transactions: Transactions[];
}): Promise<Set<string>> => {
  const transferIds = transactions.flatMap((tx) => (tx.transferId ? [tx.transferId] : []));
  if (!transferIds.length) return new Set();

  const baseLegs = await findTransactions({
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    paranoid: false,
    where: { transferId: { [Op.in]: transferIds }, currencyCode: baseCurrencyCode },
    attributes: ['transferId'],
  });

  return new Set(baseLegs.map((leg) => leg.transferId));
};

const isRateDerivedTransfer = ({ tx, anchored }: { tx: Transactions; anchored: Set<string> }): boolean =>
  !(
    tx.transferId &&
    anchored.has(tx.transferId) &&
    (tx.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer ||
      tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan)
  );

const valueTransactions = async ({
  userId,
  baseCurrencyCode,
  currencyCode,
  intervals,
}: {
  userId: number;
  baseCurrencyCode: string;
  currencyCode: string;
  intervals: RateInterval[];
}): Promise<{ transactionsUpdated: number; splitsUpdated: number }> => {
  const selectors = buildRowSelectors({ intervals });
  const envelope = selectorEnvelope({ selectors });

  const candidates = await findTransactions({
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    paranoid: false,
    where: {
      currencyCode,
      refCurrencyCode: baseCurrencyCode,
      ...(envelope.from || envelope.to
        ? {
            time: {
              ...(envelope.from ? { [Op.gte]: envelope.from } : {}),
              ...(envelope.to ? { [Op.lt]: envelope.to } : {}),
            },
          }
        : {}),
      ...(envelope.onlyMissing ? { refAmountMissing: true } : {}),
    },
  });

  const selected = candidates.filter((tx) =>
    matchesRowSelectors({ selectors, row: { time: tx.time, refAmountMissing: tx.refAmountMissing } }),
  );
  if (!selected.length) return { transactionsUpdated: 0, splitsUpdated: 0 };

  const anchored = await findAnchoredTransferIds({ userId, baseCurrencyCode, transactions: selected });
  const toValue = selected.filter((tx) => isRateDerivedTransfer({ tx, anchored }));

  // The account owner's definition of the currency rounds the amount, whoever entered it.
  const accounts = await Accounts.findAll({
    where: { id: { [Op.in]: [...new Set(toValue.map((tx) => tx.accountId))] } },
    attributes: ['id', 'userId'],
    raw: true,
  });
  const ownerByAccountId = new Map(accounts.map((account) => [account.id, account.userId]));

  const convert = ({ tx, amount }: { tx: Transactions; amount: Money }) =>
    calculateRefAmountOrNull({
      userId,
      amountOwnerUserId: ownerByAccountId.get(tx.accountId) ?? userId,
      amount,
      baseCode: currencyCode,
      quoteCode: baseCurrencyCode,
      date: tx.time,
      bypassCache: true,
    });

  let transactionsUpdated = 0;
  let splitsUpdated = 0;

  for (const tx of toValue) {
    const refAmount = await convert({ tx, amount: tx.amount });
    const refCommissionRate = tx.commissionRate.isZero()
      ? Money.zero()
      : await convert({ tx, amount: tx.commissionRate });

    if (
      !moneyEqualsOrNull(refAmount, tx.refAmount) ||
      !moneyEqualsOrNull(refCommissionRate, tx.refCommissionRate) ||
      tx.refAmountMissing !== (refAmount === null)
    ) {
      tx.refAmount = refAmount;
      tx.refCommissionRate = refCommissionRate;
      // The save skips hooks, which is where the flag normally follows `refAmount`; the hooks would
      // also move balances that this change does not touch.
      tx.refAmountMissing = refAmount === null;
      await tx.save({ hooks: false });
      transactionsUpdated += 1;
    }

    const splits = await TransactionSplits.findAll({ where: { transactionId: tx.id } });
    for (const split of splits) {
      const splitRefAmount = await convert({ tx, amount: split.amount });

      if (!moneyEqualsOrNull(splitRefAmount, split.refAmount)) {
        split.refAmount = splitRefAmount;
        await split.save({ hooks: false });
        splitsUpdated += 1;
      }
    }
  }

  return { transactionsUpdated, splitsUpdated };
};

/**
 * Values the user's own accounts again after a change to the rates of the currencies they hold.
 * The opening balance is stamped at the rate of the ledger boundary, so it follows the rate of that
 * day; the spot measures follow today's rate; and the stored history is rebuilt day by day.
 */
const valueAccounts = async ({
  userId,
  currencyCodes,
  fillOnlyCodes,
  remeasureSpot,
}: {
  userId: number;
  currencyCodes: string[];
  /** Currencies whose rates only gained a new day: their already valued accounts keep their stamps. */
  fillOnlyCodes: Set<string>;
  remeasureSpot: boolean;
}): Promise<number> => {
  const accounts = await Accounts.findAll({ where: { userId, currencyCode: { [Op.in]: currencyCodes } } });

  let restamped = 0;
  for (const account of accounts) {
    // A new day's rate only completes what has no value yet.
    if (fillOnlyCodes.has(account.currencyCode) && account.refInitialBalance !== null) continue;

    if ((await restampRefInitialBalance({ accountId: account.id })) === 'restamped') restamped += 1;
  }

  if (remeasureSpot) await remeasureRefBalances({ userId, currencyCodes });

  for (const account of accounts) {
    await scheduleBalanceRevalue({ accountId: account.id });
  }

  return restamped;
};

/**
 * Values a user's saved rows in custom currencies again after the rates behind them changed: the
 * `refAmount` and `refCommissionRate` of transactions, the ref amounts of their splits, the
 * `refAmountMissing` flag, the accounts' base-currency balances and the stored balance history.
 *
 * `changes` say which currency changed on which days; a change may name an ISO currency whose manual
 * rate into the base moved. They are expanded first through the user's pegs and stored quotes, so a
 * currency priced through a changed one is valued again for the same days. A `recompute` change
 * values every row of those days; a `fill` change (a rate for a new day) only values rows still
 * waiting for a rate. Each row is converted with the rate in force on its own
 * date, and only a row whose value differs is written. ISO currencies are never valued: their saved
 * transactions keep the base amounts they were saved with. A user with no base currency has nothing
 * to value, and the result is empty.
 *
 * Runs inside the caller's database transaction when there is one, so it sees rates the caller wrote
 * and commits with them. The user's cached converted amounts are dropped after that commit.
 */
export const recomputeCustomRefAmounts = withTransaction(
  async ({
    userId,
    changes,
    remeasureSpot = true,
  }: {
    userId: number;
    changes: CustomRateChange[];
    /** Set to false when the caller re-measures the spot balances of all the user's accounts itself. */
    remeasureSpot?: boolean;
  }): Promise<RecomputeResult> => {
    if (!changes.length) return EMPTY_RESULT;

    // A user with no base currency has nothing to value amounts in.
    const baseCurrency = await getBaseCurrency({ userId });
    if (!baseCurrency) return EMPTY_RESULT;

    // An ISO seed (a manual ISO rate into the base) is expanded too: it reaches the custom
    // currencies pegged to or quoted in it. Only custom codes are valued afterwards.
    const scope = expandScope({ scope: buildScope({ changes }), edges: await loadDependencyEdges({ userId }) });
    const customCodes = await findCustomCurrencyCodes({ codes: [...scope.keys()] });
    const currencyCodes = [...scope.keys()].filter(
      (code) => customCodes.has(code.toUpperCase()) && code !== baseCurrency.currency.code,
    );
    if (!currencyCodes.length) return EMPTY_RESULT;

    let transactionsUpdated = 0;
    let splitsUpdated = 0;
    for (const currencyCode of currencyCodes) {
      const result = await valueTransactions({
        userId,
        baseCurrencyCode: baseCurrency.currency.code,
        currencyCode,
        intervals: scope.get(currencyCode)!,
      });
      transactionsUpdated += result.transactionsUpdated;
      splitsUpdated += result.splitsUpdated;
    }

    const fillOnlyCodes = new Set(
      currencyCodes.filter((code) => scope.get(code)!.every((interval) => interval.mode === 'fill')),
    );
    const accountsRestamped = await valueAccounts({ userId, currencyCodes, fillOnlyCodes, remeasureSpot });

    clearUserRefAmountCacheAfterCommit({ userId });

    return { currencyCodes, transactionsUpdated, splitsUpdated, accountsRestamped };
  },
);
