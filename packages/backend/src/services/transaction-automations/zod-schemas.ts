import {
  AUTOMATION_AMOUNT_OPERATORS,
  AUTOMATION_LIMITS,
  AUTOMATION_LIST_OPERATORS,
  AUTOMATION_NOTE_MODES,
  AUTOMATION_TEXT_OPERATORS,
  type AutomationAction,
  type AutomationCondition,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import type { Equals, Expect } from '@bt/shared/types/type-testing';
import { currencyCode, recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { z } from 'zod';

const listOperator = z.enum(AUTOMATION_LIST_OPERATORS);
const idList = uniqueRecordIds({ min: 1, max: AUTOMATION_LIMITS.maxIds });

const keywords = z
  .array(z.string().trim().min(1).max(AUTOMATION_LIMITS.maxKeywordLength))
  .max(AUTOMATION_LIMITS.maxKeywords);

const idListCondition = <F extends 'payee' | 'account' | 'accountGroup' | 'bankConnection'>(field: F) =>
  z.object({ field: z.literal(field), operator: listOperator, value: idList });

const textCondition = <F extends 'note' | 'merchant'>(field: F) =>
  z.object({
    field: z.literal(field),
    operator: z.enum(AUTOMATION_TEXT_OPERATORS),
    value: keywords.default([]),
  });

const amountCurrency = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('transaction') }),
  z.object({ mode: z.literal('base') }),
  z.object({ mode: z.literal('specific'), code: currencyCode() }),
]);

const dayOfMonthValue = z
  .object({
    min: z.number().int().min(1).max(31),
    max: z.number().int().min(1).max(31),
  })
  .refine(({ min, max }) => min <= max, { message: 'min must be <= max' });

/**
 * Cross-field rules the discriminated union can't express: which bounds an
 * amount operator needs, and that a text operator other than `is_empty`
 * carries at least one keyword (`is_empty` ignores `value` entirely).
 */
const conditionItemSchema = z
  .discriminatedUnion('field', [
    textCondition('note'),
    textCondition('merchant'),
    idListCondition('payee'),
    idListCondition('account'),
    idListCondition('accountGroup'),
    idListCondition('bankConnection'),
    z.object({
      field: z.literal('amount'),
      operator: z.enum(AUTOMATION_AMOUNT_OPERATORS),
      value: z.object({ min: z.number().optional(), max: z.number().optional() }),
      currency: amountCurrency,
    }),
    z.object({
      field: z.literal('transactionType'),
      operator: z.literal('equals'),
      value: z.enum(TRANSACTION_TYPES),
    }),
    z.object({ field: z.literal('dayOfMonth'), operator: z.literal('between'), value: dayOfMonthValue }),
  ])
  .superRefine((item, ctx) => {
    if ((item.field === 'note' || item.field === 'merchant') && item.operator !== 'is_empty' && !item.value.length) {
      ctx.addIssue({ code: 'custom', message: 'At least one keyword is required', path: ['value'] });
    }

    if (item.field === 'amount') {
      const { min, max } = item.value;
      if (item.operator === 'between') {
        if (min === undefined || max === undefined) {
          ctx.addIssue({ code: 'custom', message: 'between requires both min and max', path: ['value'] });
        } else if (min > max) {
          ctx.addIssue({ code: 'custom', message: 'min must be <= max', path: ['value'] });
        }
      } else if (item.operator === 'lte') {
        if (max === undefined || min !== undefined) {
          ctx.addIssue({ code: 'custom', message: 'lte requires max only', path: ['value'] });
        }
      } else if (min === undefined || max !== undefined) {
        ctx.addIssue({ code: 'custom', message: `${item.operator} requires min only`, path: ['value'] });
      }
    }
  });

export const conditionsSchema = z
  .object({
    match: z.enum(['all', 'any']),
    items: z.array(conditionItemSchema).min(1).max(AUTOMATION_LIMITS.maxConditions),
  })
  .refine(({ items }) => items.filter((item) => item.field === 'transactionType').length <= 1, {
    message: 'At most one transactionType condition is allowed',
    path: ['items'],
  });

export const actionsSchema = z
  .array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('set_category'), categoryId: recordId() }),
      z.object({ type: z.literal('add_tags'), tagIds: idList }),
      z.object({ type: z.literal('set_payee'), payeeId: recordId() }),
      z.object({
        type: z.literal('set_note'),
        mode: z.enum(AUTOMATION_NOTE_MODES),
        value: z.string().trim().min(1).max(AUTOMATION_LIMITS.maxNoteLength),
      }),
      z.object({ type: z.literal('exclude_from_stats') }),
    ]),
  )
  .min(1)
  .max(AUTOMATION_LIMITS.maxActions)
  .refine((actions) => new Set(actions.map((action) => action.type)).size === actions.length, {
    message: 'Action types must be unique',
  });

const name = z.string().trim().min(1).max(AUTOMATION_LIMITS.maxNameLength);

export const automationIdParamsSchema = z.object({ id: recordId() });

export const createAutomationBodySchema = z.object({
  name,
  isEnabled: z.boolean().optional(),
  conditions: conditionsSchema,
  actions: actionsSchema,
});

export const updateAutomationBodySchema = z.object({
  name: name.optional(),
  isEnabled: z.boolean().optional(),
  conditions: conditionsSchema.optional(),
  actions: actionsSchema.optional(),
});

export const reorderAutomationsBodySchema = z.object({
  ids: uniqueRecordIds({ max: AUTOMATION_LIMITS.maxRules }),
});

export const previewAutomationBodySchema = z
  .object({
    conditions: conditionsSchema.optional(),
    automationId: recordId().optional(),
    limit: z.number().int().min(1).max(AUTOMATION_LIMITS.maxApplyIds).optional(),
  })
  .refine(({ conditions, automationId }) => Boolean(conditions) !== Boolean(automationId), {
    message: 'Provide exactly one of conditions or automationId',
  });

export const applyAutomationBodySchema = z.object({
  transactionIds: uniqueRecordIds({ min: 1, max: AUTOMATION_LIMITS.maxApplyIds }),
});

/**
 * Drift guard: the schema must infer exactly the shared contract. `transactionType` is
 * excluded because `z.enum` on a TS enum infers the member union, which `Equals` treats
 * as distinct from the enum type.
 * @public
 */
export type ConditionItemsSchemaIsInSync = Expect<
  Equals<
    Exclude<z.infer<typeof conditionsSchema>['items'][number], { field: 'transactionType' }>,
    Exclude<AutomationCondition, { field: 'transactionType' }>
  >
>;
/** @public */
export type ActionsSchemaIsInSync = Expect<Equals<z.infer<typeof actionsSchema>, AutomationAction[]>>;
