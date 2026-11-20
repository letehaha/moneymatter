import { GOAL_NAME_MAX_LENGTH, GOAL_REACHED_HOLD_DAYS_MAX } from '@bt/shared/types';
import { boundedDecimalAmount, currencyCode, dateBound, recordId } from '@common/lib/zod/custom-types';
import { logoFieldsShape, logoImageSchema } from '@controllers/common/logo-fields.schema';
import { z } from 'zod';

// A share of the balance, not money: it is stored as DECIMAL(5,2), so two places whatever the currency.
const sharePercent = () =>
  z
    .number()
    .positive()
    .max(100)
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(String(value)), 'At most 2 decimal places');

const goalAccountsSchema = z
  .array(
    z
      .strictObject({
        accountId: recordId(),
        sharePercent: sharePercent().nullable().optional(),
        fixedAmount: boundedDecimalAmount({ positive: true }).nullable().optional(),
        fixedPosition: z.int32().min(0).nullable().optional(),
      })
      .superRefine((share, ctx) => {
        if ((share.sharePercent == null) === (share.fixedAmount == null)) {
          ctx.addIssue({ code: 'custom', message: 'Set exactly one of sharePercent and fixedAmount' });
        }
        if (share.fixedPosition != null && share.fixedAmount == null) {
          ctx.addIssue({ code: 'custom', path: ['fixedPosition'], message: 'fixedPosition needs fixedAmount' });
        }
      }),
  )
  .min(1)
  .refine((shares) => new Set(shares.map((share) => share.accountId)).size === shares.length, {
    message: 'IDs must be unique',
  });

/**
 * Goal amounts (`targetAmount`, `plannedMonthly`, `fixedAmount`) take any decimals the storage holds:
 * the goal services round each half-up to its currency's decimals with `roundGoalAmount` and refuse
 * one that rounds to zero.
 */
export const goalFieldsShape = {
  name: z.string().trim().min(1).max(GOAL_NAME_MAX_LENGTH),
  currencyCode: currencyCode(),
  targetAmount: boundedDecimalAmount({ positive: true }),
  targetDate: dateBound().nullable().optional(),
  plannedMonthly: boundedDecimalAmount({ positive: true }).nullable().optional(),
  sortOrder: z.int32().min(0).optional(),
  reachedHoldDays: z.int32().min(0).max(GOAL_REACHED_HOLD_DAYS_MAX).optional(),
  accounts: goalAccountsSchema,
  ...logoFieldsShape,
  logoImage: logoImageSchema,
};
