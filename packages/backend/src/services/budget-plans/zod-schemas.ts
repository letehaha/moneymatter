import { BUDGET_PLAN_CADENCES, BUDGET_PLAN_CARRY_POLICIES, BUDGET_PLAN_TYPE_KEYS } from '@bt/shared/types';
import {
  boundedDecimalAmount,
  budgetPlanName,
  budgetSuggestionAnswers,
  dateBound,
  uniqueRecordIds,
} from '@common/lib/zod/custom-types';
import { z } from 'zod';

/**
 * Create body of `POST /budget-plans`. The field shape is what the MCP tool exposes as its input;
 * the strict schema below is what both callers parse with.
 */
export const createPlanBodyFields = {
  name: budgetPlanName(),
  type: z.enum(BUDGET_PLAN_TYPE_KEYS),
  cadence: z.enum(BUDGET_PLAN_CADENCES),
  intervalN: z.number().int().min(1).optional(),
  anchorDate: dateBound(),
  secondAnchorDay: z.number().int().min(1).max(31).optional(),
  epochDate: dateBound().optional(),
  accountIds: uniqueRecordIds({ min: 1 }),
  autoAttachAccounts: z.boolean().optional(),
  carryPolicy: z.enum(BUDGET_PLAN_CARRY_POLICIES).optional(),
  poolEnabled: z.boolean().optional(),
  withSuggestedLines: z.boolean().optional(),
  suggestionAnswers: budgetSuggestionAnswers().optional(),
};

export const createPlanBodySchema = z.strictObject(createPlanBodyFields);

/**
 * Patch body of `PATCH /budget-plans/:planId`. Cadence, anchor, epoch and type are immutable, so
 * sending one is a client bug and the strict schema refuses it.
 */
export const updatePlanBodyFields = {
  name: budgetPlanName().optional(),
  autoAttachAccounts: z.boolean().optional(),
  carryPolicy: z.enum(BUDGET_PLAN_CARRY_POLICIES).optional(),
  poolEnabled: z.boolean().optional(),
  zeroSum: z.boolean().optional(),
  expectedIncome: boundedDecimalAmount().nullable().optional(),
};

export const updatePlanBodySchema = z.strictObject(updatePlanBodyFields);

/** Body of `POST /budget-plans/:planId/restore`; the body itself is optional. */
export const restorePlanBodyFields = { replace: z.boolean().optional() };

export const restorePlanBodySchema = z.strictObject(restorePlanBodyFields).optional();

/** Body of `PUT /budget-plans/:planId/accounts`. */
export const setPlanAccountsBodyFields = { accountIds: uniqueRecordIds() };

export const setPlanAccountsBodySchema = z.strictObject(setPlanAccountsBodyFields);

/** Body of `POST /budget-plans/:planId/groups`. */
export const createGroupBodyFields = { name: budgetPlanName() };

export const createGroupBodySchema = z.strictObject(createGroupBodyFields);

/** Body of `PATCH /budget-plans/:planId/groups/:groupId`. */
export const updateGroupBodyFields = { name: budgetPlanName() };

export const updateGroupBodySchema = z.strictObject(updateGroupBodyFields);
