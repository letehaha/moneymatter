import { TRANSACTION_TYPES } from '@bt/shared/types';
import { dateRange, recordId, withDateOrder } from '@common/lib/zod/custom-types';
import { z } from 'zod';

export const BULK_SCAN_DEFAULT_LIMIT = 20;
export const BULK_SCAN_MAX_LIMIT = 50;

/**
 * Refund and transfer recommendations take either a transaction id (the service derives everything
 * from it) or the form data of a transaction that is not saved yet.
 */
export const recommendationQuerySchema = z
  .object({
    transactionId: recordId().optional(),
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
  );

export type RecommendationQuery = z.infer<typeof recommendationQuerySchema>;

export const bulkScanBodySchema = withDateOrder(
  z.object({
    ...dateRange({ required: true, precision: 'datetime', offset: true }),
    limit: z.number().int().positive().max(BULK_SCAN_MAX_LIMIT).optional().default(BULK_SCAN_DEFAULT_LIMIT),
    offset: z.number().int().min(0).optional().default(0),
    includeOutOfWallet: z.boolean().optional().default(false),
    aiReview: z.boolean().optional().default(false),
  }),
);

export const dismissBodySchema = z.object({
  expenseTransactionId: recordId(),
  incomeTransactionId: recordId(),
});
