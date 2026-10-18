import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import Accounts from '@models/accounts.model';
import { getTransactionById } from '@models/transactions.model';
import { calculateRefAmountOrNull } from '@services/calculate-ref-amount.service';
import { getTransactions } from '@services/transactions/get-transactions';

// ±50 in base currency for refund recommendations
const RECOMMENDATION_REF_AMOUNT_RANGE = Money.fromDecimal(50);
const RECOMMENDATION_MONTHS_RANGE = 6;
const RECOMMENDATION_LIMIT = 5;

interface GetRefundRecommendationsParams {
  userId: number;
  // Option 1: a saved transaction, from which everything is derived
  transactionId?: string;
  // Option 2: the form data of a transaction that is not saved yet
  transactionType?: string;
  originAmount?: number;
  accountId?: string;
}

/**
 * Opposite-type transactions of the last six months within ±50 of the base-currency amount: the
 * rows a refund could be linked to. Returns nothing for an unknown transaction or account.
 */
export async function getRefundRecommendations({
  userId,
  transactionId,
  transactionType,
  originAmount,
  accountId,
}: GetRefundRecommendationsParams) {
  let searchTransactionType: TRANSACTION_TYPES;
  let refAmountCenter: Money | null;

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
  } else {
    // Use form data - need to calculate refAmount

    // Search for opposite transaction type
    searchTransactionType =
      transactionType === TRANSACTION_TYPES.income ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;

    // Get account to find currency
    const account = (await Accounts.findOne({
      where: { id: accountId, userId },
      attributes: ['currencyCode'],
      raw: true,
    })) as Pick<Accounts, 'currencyCode'> | null;

    if (!account) {
      return [];
    }

    // Calculate refAmount from the form amount
    refAmountCenter = await calculateRefAmountOrNull({
      amount: Money.fromDecimal(originAmount!),
      userId,
      baseCode: account.currencyCode,
      date: new Date(),
    });
  }

  // Candidates are found by base-currency amount: with none (custom currency, no rate yet) there is nothing to match.
  if (!refAmountCenter) return [];

  // Calculate refAmount range
  const lowerBound = refAmountCenter.subtract(RECOMMENDATION_REF_AMOUNT_RANGE);
  const refAmountGte = lowerBound.isNegative() ? Money.zero() : lowerBound;
  const refAmountLte = refAmountCenter.add(RECOMMENDATION_REF_AMOUNT_RANGE);

  // Calculate date range (last 6 months)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - RECOMMENDATION_MONTHS_RANGE);

  return getTransactions({
    userId,
    from: 0,
    limit: RECOMMENDATION_LIMIT,
    transactionType: searchTransactionType,
    excludeTransfer: true,
    // Rows already acting as a refund can't be linked again, so they are dropped —
    // except refunds of the requested tx itself, which the edit dialog still lists.
    // Originals that merely carry partial refunds remain valid candidates.
    excludeRefundTxs: true,
    keepRefundsForTxId: transactionId,
    // Planned rows can't be refund-linked, so they are not valid candidates either.
    isPlanned: false,
    includeSplits: true,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    refAmountGte,
    refAmountLte,
  });
}
