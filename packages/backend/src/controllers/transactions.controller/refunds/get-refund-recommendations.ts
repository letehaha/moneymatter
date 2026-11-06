import { TRANSACTION_TYPES } from '@bt/shared/types';
import { booleanQuery, dateBound, recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { createController } from '@controllers/helpers/controller-factory';
import Accounts from '@models/accounts.model';
import { getTransactionById } from '@models/transactions.model';
import { serializeTransactions } from '@root/serializers';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import * as transactionsService from '@services/transactions';
import { z } from 'zod';

import { isRefundPivotPaired, refundPivotPairIssue } from '../transaction-filters';

// ±50 in base currency for refund recommendations
const RECOMMENDATION_REF_AMOUNT_RANGE = 5000;
const RECOMMENDATION_MONTHS_RANGE = 6;
const RECOMMENDATION_LIMIT = 5;

const schema = z.object({
  query: z
    .object({
      // Option 1: Provide transaction ID - backend derives everything
      transactionId: recordId().optional(),
      // Option 2: form data of a transaction being created. `transactionType` is the type of
      // that transaction itself; candidates are always of the opposite type.
      transactionType: z.enum(Object.values(TRANSACTION_TYPES) as [string, ...string[]]).optional(),
      originAmount: z.preprocess((val) => (val ? Number(val) : undefined), z.number().positive().optional()),
      accountId: recordId().optional(),
      includeRefundedAmount: booleanQuery().optional(),
      // Role of the requested transaction relative to the candidates: 'refund' lists rows it
      // could refund, 'original' lists rows that could refund it. Without it the pivot bounds
      // decide per row, and without those too 'refund' is assumed.
      refundRole: z.enum(['refund', 'original']).optional(),
      refundPivotFrom: dateBound({ precision: 'datetime' }).optional(),
      refundPivotTo: dateBound({ precision: 'datetime' }).optional(),
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
    )
    .refine(isRefundPivotPaired, refundPivotPairIssue),
});

const buildLinkabilityFilters = ({
  refundRole,
  refundPivotFrom,
  refundPivotTo,
  transactionId,
}: {
  refundRole?: 'refund' | 'original';
  refundPivotFrom?: string;
  refundPivotTo?: string;
  transactionId?: string;
}) => {
  // Shares are set from the refund side, so a refund already linked elsewhere can't be added here.
  if (refundRole === 'original') {
    return { excludeRefundTxs: true, excludeRefundedTxs: true, keepRefundsForTxId: transactionId };
  }
  if (refundRole === 'refund' || !refundPivotFrom) {
    return { excludeRefundTxs: true, keepRefundsForTxId: transactionId };
  }
  return { refundPivotFrom, refundPivotTo, keepRefundsForTxId: transactionId };
};

export default createController(schema, async ({ user, query }) => {
  const { id: userId } = user;

  let searchTransactionType: TRANSACTION_TYPES;
  let refAmountCenter: Money;

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
  } else {
    // Use form data - need to calculate refAmount
    const { transactionType, originAmount, accountId } = query;

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
      return { data: [] };
    }

    // Calculate refAmount from the form amount
    refAmountCenter = await calculateRefAmount({
      amount: Money.fromDecimal(originAmount!),
      userId,
      baseCode: account.currencyCode,
      date: new Date(),
    });
  }

  // Calculate refAmount range
  const centerCents = refAmountCenter.toCents();
  const refAmountGte = Money.fromCents(Math.max(0, centerCents - RECOMMENDATION_REF_AMOUNT_RANGE));
  const refAmountLte = Money.fromCents(centerCents + RECOMMENDATION_REF_AMOUNT_RANGE);

  // Calculate date range (last 6 months)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - RECOMMENDATION_MONTHS_RANGE);

  const transactions = await transactionsService.getTransactions({
    userId,
    from: 0,
    limit: RECOMMENDATION_LIMIT,
    transactionType: searchTransactionType,
    excludeTransfer: true,
    // Planned rows can't be refund-linked, so they are not valid candidates either.
    isPlanned: false,
    includeRefundedAmount: query.includeRefundedAmount,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    refAmountGte,
    refAmountLte,
    ...buildLinkabilityFilters(query),
  });

  return { data: serializeTransactions(transactions) };
});
