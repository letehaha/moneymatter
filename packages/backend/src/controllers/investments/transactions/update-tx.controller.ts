import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { isoCurrencyCode, numericString, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updateInvestmentTransaction } from '@services/investments/transactions/update.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      transactionId: recordId(),
    }),
    body: z.object({
      category: z.nativeEnum(INVESTMENT_TRANSACTION_CATEGORY).optional(),
      // Accept a date-only value ("2026-06-20") or a full ISO 8601 datetime
      // ("2026-06-20T09:00:00.000Z"). Date-only is normalized to UTC midnight.
      date: z.union([z.string().date(), z.string().datetime({ offset: true })]).optional(),
      quantity: z
        .string()
        .optional()
        .refine((val) => val === undefined || (!isNaN(parseFloat(val)) && parseFloat(val) > 0), {
          message: 'Quantity must be a positive number',
        }),
      price: z
        .string()
        .optional()
        // Zero allowed: staking rewards / airdrops / burns / balance adjustments
        // are real position changes with no cash side.
        .refine((val) => val === undefined || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0), {
          message: 'Price must be a non-negative number',
        }),
      fees: z
        .string()
        .optional()
        .refine((val) => val === undefined || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0), {
          message: 'Fees must be a non-negative number',
        }),
      name: z.string().optional(),
      // Settlement leg updates. Cross-field rules (when settlementFees is
      // required, currency mismatch handling) depend on the stored transaction
      // and the holding's currency, so they live in the service.
      settlementCurrencyCode: isoCurrencyCode().optional(),
      settlementAmount: numericString({ allowZero: true }).optional(),
      settlementFees: numericString({ allowZero: true }).optional(),
      settlementRate: numericString().optional(),
    }),
  }),
  async ({ user, params, body }) => {
    const transaction = await updateInvestmentTransaction({
      userId: user.id,
      transactionId: params.transactionId,
      ...body,
    });
    return { data: transaction };
  },
);
