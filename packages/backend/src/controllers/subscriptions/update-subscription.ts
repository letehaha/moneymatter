import {
  MAX_REMIND_BEFORE_PRESETS,
  REMIND_BEFORE_PRESETS,
  RemindBeforePreset,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_TYPES,
} from '@bt/shared/types';
import { currencyCode, dateBound, recordId, withDateOrder } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFields } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import * as subscriptionsService from '@services/subscriptions';
import { z } from 'zod';

import { matchingRulesSchema } from './shared-schemas';

const remindBeforePresetValues = Object.values(REMIND_BEFORE_PRESETS) as [RemindBeforePreset, ...RemindBeforePreset[]];

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: withDateOrder(
    z
      .object({
        name: z.string().min(1).max(200).trim().optional(),
        type: z.enum(Object.values(SUBSCRIPTION_TYPES) as [SUBSCRIPTION_TYPES, ...SUBSCRIPTION_TYPES[]]).optional(),
        // Decimal amount (e.g. 9.99). Stored as cents internally by the service.
        expectedAmount: z.number().nonnegative().nullable().optional(),
        expectedCurrencyCode: currencyCode().nullable().optional(),
        frequency: z
          .enum(Object.values(SUBSCRIPTION_FREQUENCIES) as [SUBSCRIPTION_FREQUENCIES, ...SUBSCRIPTION_FREQUENCIES[]])
          .optional(),
        startDate: dateBound().optional(),
        endDate: dateBound().nullable().optional(),
        accountId: recordId().nullable().optional(),
        categoryId: recordId().nullable().optional(),
        payeeId: recordId().nullable().optional(),
        tagIds: z.array(recordId()).optional(),
        matchingRules: matchingRulesSchema.optional(),
        isActive: z.boolean().optional(),
        notes: z.string().max(5000).nullable().optional(),
        dueDate: dateBound().nullable().optional(),
        maxOccurrences: z.number().int().positive().nullable().optional(),
        remindBefore: z.array(z.enum(remindBeforePresetValues)).max(MAX_REMIND_BEFORE_PRESETS).optional(),
        notifyEmail: z.boolean().optional(),
        autoRecord: z.boolean().optional(),
        // Absent key → no change; a key that changes the stored value stamps
        // logoSource 'manual'; a null that clears nothing writes nothing.
        ...logoFieldsShape,
      })
      .superRefine((data, ctx) => {
        refineLogoFields({ data, ctx });

        // When both are explicitly provided in the same update, they must be consistent
        const hasAmount = data.expectedAmount !== undefined ? data.expectedAmount != null : undefined;
        const hasCurrency = data.expectedCurrencyCode !== undefined ? data.expectedCurrencyCode != null : undefined;

        if (hasAmount !== undefined && hasCurrency !== undefined && hasAmount !== hasCurrency) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Both expectedAmount and expectedCurrencyCode must be provided together.',
            path: [hasAmount ? 'expectedCurrencyCode' : 'expectedAmount'],
          });
        }

        // When this update sets the type to installment, the count and schedule that
        // define the finite plan must travel in the same payload (the edit form sends
        // the full object). A partial payload that nulls either is caught by the DB
        // CHECK constraint instead.
        if (data.type === SUBSCRIPTION_TYPES.installment) {
          if (data.maxOccurrences == null) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Installments require maxOccurrences (the number of payments).',
              path: ['maxOccurrences'],
            });
          }
          if (data.dueDate == null) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Installments require a payment schedule date (dueDate).',
              path: ['dueDate'],
            });
          }
        }

        // When this update turns auto-record ON in the same payload, the booking
        // inputs must travel with it and matching rules (if also sent) must be
        // empty. A partial payload that flips only the toggle is caught by the
        // service-layer merge validation against the stored row.
        if (data.autoRecord === true) {
          if (data.accountId === null) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t({ key: 'subscriptions.validation.autoRecord.requiresAccountField' }),
              path: ['accountId'],
            });
          }
          if (data.expectedAmount === null || data.expectedCurrencyCode === null) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t({ key: 'subscriptions.validation.autoRecord.requiresAmountField' }),
              path: ['expectedAmount'],
            });
          }
          if (data.matchingRules && data.matchingRules.rules.length > 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t({ key: 'subscriptions.validation.autoRecord.excludesMatchingField' }),
              path: ['matchingRules'],
            });
          }
        }
      }),
    ['startDate', 'endDate'],
  ),
});

export default createController(schema, async ({ user, params, body }) => {
  const subscription = await subscriptionsService.updateSubscription({
    id: params.id,
    userId: user.id,
    ...body,
  });

  return { data: subscription };
});
