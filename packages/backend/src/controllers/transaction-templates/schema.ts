import {
  type CreateTransactionTemplateBody,
  type Expect,
  type MutuallyAssignable,
  PAYMENT_TYPES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { currencyCode, recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { nonNegativeAmountSchema } from '@controllers/transactions.controller/schemas';
import { z } from 'zod';

export const templateBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  transactionType: z.nativeEnum(TRANSACTION_TYPES),
  amount: nonNegativeAmountSchema().nullable().optional(),
  accountId: recordId().nullable().optional(),
  categoryId: recordId().nullable().optional(),
  payeeId: recordId().nullable().optional(),
  paymentType: z.nativeEnum(PAYMENT_TYPES).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  originalCurrencyCode: currencyCode().nullable().optional(),
  tagIds: uniqueRecordIds().optional(),
});

/**
 * Fails `tsc` when the request schema and the shared payload type drift apart.
 * @public exported only so the assertion is not flagged as unused.
 */
export type CreateBodySchemaIsInSync = Expect<
  MutuallyAssignable<z.infer<typeof templateBodySchema>, CreateTransactionTemplateBody>
>;
