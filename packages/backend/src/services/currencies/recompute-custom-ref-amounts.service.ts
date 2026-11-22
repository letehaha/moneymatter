import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { type ConversionDecimals, getConversionDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { ExchangeRateUnavailableError } from '@js/errors';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import TransactionSplits from '@models/transaction-splits.model';
import { findTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { remeasureRefBalances } from '@services/accounts/remeasure-ref-balances';
import { restampRefInitialBalance } from '@services/accounts/restamp-ref-initial-balance';
import { scheduleBalanceRevalue } from '@services/balances/revalue-balance-history.service';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { clearRefAmountCache } from '@services/ref-amount-cache';
import { getExchangeRate } from '@services/user-exchange-rate';
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
    },
  });

  const selected = candidates.filter((tx) => matchesRowSelectors({ selectors, row: { time: tx.time } }));
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

  const rateByDay = new Map<string, Promise<number>>();
  const decimalsByOwner = new Map<number, Promise<ConversionDecimals>>();

  // The custom side is read by UTC day and the ISO leg by the server's local day, so both form the key.
  const rateFor = ({ time }: { time: Date }) => {
    const day = `${time.toISOString().slice(0, 10)}|${time.toDateString()}`;
    if (!rateByDay.has(day)) {
      const rate = getExchangeRate({
        userId,
        date: new Date(time),
        baseCode: currencyCode,
        quoteCode: baseCurrencyCode,
        bypassCache: true,
      }).then((result) => result.rate);
      rateByDay.set(day, rate);
    }
    return rateByDay.get(day)!;
  };

  const decimalsFor = ({ owner }: { owner: number }) => {
    if (!decimalsByOwner.has(owner)) {
      const decimals = getConversionDecimals({
        userId,
        baseCode: currencyCode,
        quoteCode: baseCurrencyCode,
        definitionOwnerUserId: owner,
      });
      decimalsByOwner.set(owner, decimals);
    }
    return decimalsByOwner.get(owner)!;
  };

  const convert = async ({ tx, amount }: { tx: Transactions; amount: Money }) => {
    const rate = await rateFor({ time: tx.time });
    const decimals = await decimalsFor({ owner: ownerByAccountId.get(tx.accountId) ?? userId });
    return calculateRefAmountFromParams({ amount, rate, ...decimals });
  };

  const splitsByTransactionId = new Map<TransactionSplits['transactionId'], TransactionSplits[]>();
  const splits = await TransactionSplits.findAll({ where: { transactionId: { [Op.in]: toValue.map((tx) => tx.id) } } });
  for (const split of splits) {
    const known = splitsByTransactionId.get(split.transactionId) ?? [];
    known.push(split);
    splitsByTransactionId.set(split.transactionId, known);
  }

  let transactionsUpdated = 0;
  let splitsUpdated = 0;

  for (const tx of toValue) {
    let refAmount: Money;
    let refCommissionRate: Money;
    try {
      refAmount = await convert({ tx, amount: tx.amount });
      refCommissionRate = tx.commissionRate.isZero() ? Money.zero() : await convert({ tx, amount: tx.commissionRate });
    } catch (error) {
      // The ISO leg of that day has no market rate: the row keeps the amount it was valued with.
      if (!(error instanceof ExchangeRateUnavailableError)) throw error;
      logger.warn('No rate to value a custom-currency transaction again; kept its amount', { transactionId: tx.id });
      continue;
    }

    if (!refAmount.equals(tx.refAmount) || !refCommissionRate.equals(tx.refCommissionRate)) {
      tx.refAmount = refAmount;
      tx.refCommissionRate = refCommissionRate;
      // Hooks would move balances that this change does not touch.
      await tx.save({ hooks: false });
      transactionsUpdated += 1;
    }

    for (const split of splitsByTransactionId.get(tx.id) ?? []) {
      const splitRefAmount = await convert({ tx, amount: split.amount });

      if (!splitRefAmount.equals(split.refAmount)) {
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
  remeasureSpot,
}: {
  userId: number;
  currencyCodes: string[];
  remeasureSpot: boolean;
}): Promise<number> => {
  const accounts = await Accounts.findAll({ where: { userId, currencyCode: { [Op.in]: currencyCodes } } });

  let restamped = 0;
  for (const account of accounts) {
    if ((await restampRefInitialBalance({ accountId: account.id })) === 'restamped') restamped += 1;
  }

  if (remeasureSpot) await remeasureRefBalances({ userId, currencyCodes });

  for (const account of accounts) {
    await scheduleBalanceRevalue({ accountId: account.id });
  }

  return restamped;
};

/**
 * A change that starts on or before a currency's earliest stored rate also reaches every day before
 * it, since those days take the earliest rate.
 */
const reachEarlierDays = async ({
  userId,
  changes,
}: {
  userId: number;
  changes: CustomRateChange[];
}): Promise<CustomRateChange[]> =>
  Promise.all(
    changes.map(async (change) => {
      if (change.from === null) return change;

      const earlier = await UserExchangeRates.count({
        where: { userId, baseCode: change.currencyCode, effectiveDate: { [Op.lt]: change.from } },
      });

      return earlier ? change : { ...change, from: null };
    }),
  );

/**
 * Values the user's saved custom-currency rows again (transactions, splits, account balances and
 * history) for the days `changes` name, expanded to the custom currencies valued through a changed
 * ISO one. Runs in the caller's transaction; ISO rows keep the base amounts they were saved with.
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
    const scope = expandScope({
      scope: buildScope({ changes: await reachEarlierDays({ userId, changes }) }),
      edges: await loadDependencyEdges({ userId }),
    });
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

    const accountsRestamped = await valueAccounts({ userId, currencyCodes, remeasureSpot });

    await clearRefAmountCache({ userId });

    return { currencyCodes, transactionsUpdated, splitsUpdated, accountsRestamped };
  },
);
