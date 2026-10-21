import { TRANSACTION_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { createController } from '@controllers/helpers/controller-factory';
import Accounts from '@models/accounts.model';
import Transactions, { getTransactionById } from '@models/transactions.model';
import { serializeTransactions } from '@root/serializers';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import * as transactionsService from '@services/transactions';
import { addDays, endOfDay, startOfDay, subDays } from 'date-fns';
import { z } from 'zod';

import { RECOMMENDATION_DAYS_RANGE, RECOMMENDATION_PERCENT_RANGE } from './constants';

const RECOMMENDATION_LIMIT = 7;

const schema = z.object({
  query: z
    .object({
      // Option 1: Provide transaction ID - backend derives everything
      transactionId: recordId().optional(),
      // Option 2: Provide form data for new transactions
      transactionType: z.enum(Object.values(TRANSACTION_TYPES) as [string, ...string[]]).optional(),
      originAmount: z.preprocess((val) => (val ? Number(val) : undefined), z.number().positive().optional()),
      accountId: recordId().optional(),
    })
    .refine(
      (data) => {
        // Either transactionId OR all form fields must be provided
        const hasTransactionId = data.transactionId !== undefined;
        const hasFormData =
          data.transactionType !== undefined && data.originAmount !== undefined && data.accountId !== undefined;
        return hasTransactionId || hasFormData;
      },
      {
        message: 'Either transactionId OR (transactionType, originAmount, accountId) must be provided',
      },
    ),
});

export default createController(schema, async ({ user, query }) => {
  const { id: userId } = user;

  let searchTransactionType: TRANSACTION_TYPES;
  let refAmountCenter: Money;
  let sourceAccountId: string;
  let sourceCurrencyCode: string;
  let sourceTime: Date;

  if (query.transactionId) {
    // Fetch the transaction and derive parameters
    const transaction = await getTransactionById({
      id: query.transactionId,
      userId,
    });

    if (!transaction) {
      return { data: [] };
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
    const { transactionType, originAmount, accountId } = query;

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
      return { data: [] };
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
  const lowerBound = refAmountCenter.multiply(1 - RECOMMENDATION_PERCENT_RANGE);
  const refAmountGte = lowerBound.isNegative() ? Money.zero() : lowerBound;
  const refAmountLte = refAmountCenter.multiply(1 + RECOMMENDATION_PERCENT_RANGE);

  // ±N days from the transaction date (symmetric window).
  // For form data (new transaction), sourceTime is already set to `new Date()` above
  // and we don't look forward since the transaction hasn't happened yet.
  const referenceDate = new Date(sourceTime);
  const startDate = subDays(startOfDay(referenceDate), RECOMMENDATION_DAYS_RANGE);
  const endDate = query.transactionId
    ? addDays(endOfDay(referenceDate), RECOMMENDATION_DAYS_RANGE)
    : endOfDay(referenceDate);

  // Fetch more than needed to allow for filtering and sorting
  const fetchLimit = RECOMMENDATION_LIMIT * 3;

  const transactions = await transactionsService.getTransactions({
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

  const filtered = (transactions as Transactions[])
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
    .slice(0, RECOMMENDATION_LIMIT);

  return { data: serializeTransactions(filtered) };
});
