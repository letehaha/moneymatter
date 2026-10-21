import { GOAL_NAME_MAX_LENGTH } from '@bt/shared/types';
import { boundedDecimalAmount, currencyCode, dateBound, recordId } from '@common/lib/zod/custom-types';
import { logoFieldsShape, logoImageSchema } from '@controllers/common/logo-fields.schema';
import { z } from 'zod';

const goalAccountsSchema = z
  .array(
    z.strictObject({
      accountId: recordId(),
      sharePercent: boundedDecimalAmount({ positive: true }).max(100),
    }),
  )
  .min(1)
  .refine((shares) => new Set(shares.map((share) => share.accountId)).size === shares.length, {
    message: 'IDs must be unique',
  });

export const goalFieldsShape = {
  name: z.string().trim().min(1).max(GOAL_NAME_MAX_LENGTH),
  currencyCode: currencyCode(),
  targetAmount: boundedDecimalAmount({ positive: true }),
  targetDate: dateBound().nullable().optional(),
  plannedMonthly: boundedDecimalAmount({ positive: true }).nullable().optional(),
  sortOrder: z.int32().min(0).optional(),
  accounts: goalAccountsSchema,
  ...logoFieldsShape,
  logoImage: logoImageSchema,
};
