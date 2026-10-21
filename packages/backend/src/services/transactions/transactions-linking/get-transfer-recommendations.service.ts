import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import Accounts from '@models/accounts.model';
import Transactions, { getTransactionById } from '@models/transactions.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { getTransactions } from '@services/transactions/get-transactions';
import { addDays, endOfDay, startOfDay, subDays } from 'date-fns';

import { RECOMMENDATION_DAYS_RANGE, RECOMMENDATION_PERCENT_RANGE } from './constants';

const RECOMMENDATION_LIMIT = 7;

interface GetTransferRecommendationsParams {
  userId: number;
  // Option 1: a saved transaction, from which everything is derived
  transactionId?: string;
  // Option 2: the form data of a transaction that is not saved yet
  transactionType?: string;
  originAmount?: number;
  accountId?: string;
}

/**
 * Opposite-type transactions on other accounts, within ±10% of the base-currency amount and ±14
 * days of the date, that could be the other leg of a transfer. Returns nothing for an unknown
 * transaction or account.
 */
export async function getTransferRecommendations({
  userId,
  transactionId,
  transactionType,
  originAmount,
  accountId,
}: GetTransferRecommendationsParams): Promise<Transactions[]> {
  let searchTransactionType: TRANSACTION_TYPES;
  let refAmountCenter: Money;
  let sourceAccountId: string;
  let sourceCurrencyCode: string;
  let sourceTime: Date;

  if (transactionId) {
    // Fetch the transaction and derive parameters
    const transaction = await getTransactionById({
      id: transactionId,
      userId,
    });

    if (!transaction) {
      return [];
    }

    // Search for opposite transaction type
    searchTransactionType =
      transaction.transactionType === TRANSACTION_TYPES.income ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;

    refAmountCenter = transaction.refAmount;
    sourceAccountId = transaction.accountId;
    sourceCurrencyCode = transaction.currencyCode;
    sourceTime = transaction.time;
  } else {
    // Use form data - need to calculate refAmount

    // Search for opposite transaction type
    searchTransactionType =
      transactionType === TRANSACTION_TYPES.income ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;

    sourceAccountId = accountId!;
    sourceTime = new Date();

    // Get account to find currency
    const account = (await Accounts.findOne({
      where: { id: accountId, userId },
      attributes: ['currencyCode'],
      raw: true,
    })) as Pick<Accounts, 'currencyCode'> | null;

    if (!account) {
      return [];
    }

    sourceCurrencyCode = account.currencyCode;

    // Calculate refAmount from the form amount
    refAmountCenter = await calculateRefAmount({
      amount: Money.fromDecimal(originAmount!),
      userId,
      baseCode: account.currencyCode,
      date: new Date(),
    });
  }

  // Calculate refAmount range (±10%)
  const centerCents = refAmountCenter.toCents();
  const refAmountGte = Money.fromCents(Math.max(0, Math.floor(centerCents * (1 - RECOMMENDATION_PERCENT_RANGE))));
  const refAmountLte = Money.fromCents(Math.ceil(centerCents * (1 + RECOMMENDATION_PERCENT_RANGE)));

  // ±N days from the transaction date (symmetric window).
  // For form data (new transaction), sourceTime is already set to `new Date()` above
  // and we don't look forward since the transaction hasn't happened yet.
  const referenceDate = new Date(sourceTime);
  const startDate = subDays(startOfDay(referenceDate), RECOMMENDATION_DAYS_RANGE);
  const endDate = transactionId ? addDays(endOfDay(referenceDate), RECOMMENDATION_DAYS_RANGE) : endOfDay(referenceDate);

  // Fetch more than needed to allow for filtering and sorting
  const fetchLimit = RECOMMENDATION_LIMIT * 3;

  const transactions = await getTransactions({
    userId,
    from: 0,
    limit: fetchLimit,
    transactionType: searchTransactionType,
    excludeTransfer: true,
    excludeRefunds: true,
    isPlanned: false,
    includeSplits: true,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    refAmountGte,
    refAmountLte,
    excludeAccountIds: [sourceAccountId],
  });

  // Post-process: filter out transactions with splits, sort by currency preference, amount proximity, date proximity
  const sourceTimeMs = sourceTime.getTime();

  return (
    (transactions as Transactions[])
      // Exclude transactions that have splits (parent transactions with splits)
      .filter((tx) => !tx.splits || tx.splits.length === 0)
      // Sort by: 1) Same currency first, 2) Amount proximity, 3) Date proximity
      .toSorted((a, b) => {
        // 1. Same currency preference (same currency = 0, different = 1)
        const aSameCurrency = a.currencyCode === sourceCurrencyCode ? 0 : 1;
        const bSameCurrency = b.currencyCode === sourceCurrencyCode ? 0 : 1;
        if (aSameCurrency !== bSameCurrency) return aSameCurrency - bSameCurrency;

        // 2. Amount proximity (closer to center = better)
        const aAmountDiff = a.refAmount.subtract(refAmountCenter).abs().toNumber();
        const bAmountDiff = b.refAmount.subtract(refAmountCenter).abs().toNumber();
        if (aAmountDiff !== bAmountDiff) return aAmountDiff - bAmountDiff;

        // 3. Date proximity (closer = better)
        const aDateDiff = Math.abs(new Date(a.time).getTime() - sourceTimeMs);
        const bDateDiff = Math.abs(new Date(b.time).getTime() - sourceTimeMs);
        return aDateDiff - bDateDiff;
      })
      .slice(0, RECOMMENDATION_LIMIT)
  );
}
