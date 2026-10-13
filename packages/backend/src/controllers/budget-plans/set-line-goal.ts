import {
  BUDGET_LINE_GOAL_ANCHORED_FREQUENCIES,
  BUDGET_LINE_GOAL_BEHAVIORS,
  BUDGET_LINE_GOAL_BEHAVIORS_BY_FREQUENCY,
  BUDGET_LINE_GOAL_FREQUENCIES,
  BUDGET_LINE_GOAL_REPEAT_MAX,
  BUDGET_LINE_GOAL_REPEAT_UNITS,
} from '@bt/shared/types';
import { boundedDecimalAmount, dateBound, recordId } from '@common/lib/zod/custom-types';
import { toUtcDateString } from '@common/utils/date';
import { createController } from '@controllers/helpers/controller-factory';
import { setLineGoal } from '@services/budget-plans/line-goals';
import { z } from 'zod';

// Mirrors the BudgetLineGoals CHECK constraints so a bad combination is a 422, not a DB error.
const schema = z.object({
  params: z.object({ planId: recordId(), lineId: recordId() }),
  body: z
    .strictObject({
      frequency: z.enum(BUDGET_LINE_GOAL_FREQUENCIES),
      behavior: z.enum(BUDGET_LINE_GOAL_BEHAVIORS),
      amount: boundedDecimalAmount({ positive: true }),
      weekday: z.int().min(0).max(6).nullable().optional(),
      anchorDate: dateBound().nullable().optional(),
      repeatEvery: z.int().min(1).nullable().optional(),
      repeatUnit: z.enum(BUDGET_LINE_GOAL_REPEAT_UNITS).nullable().optional(),
      stopAtBalance: boundedDecimalAmount({ positive: true }).nullable().optional(),
      fundingCap: boundedDecimalAmount({ positive: true }).nullable().optional(),
      periodId: recordId().optional(),
    })
    .superRefine((body, ctx) => {
      const fail = ({ path, message }: { path: string; message: string }) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      const { frequency, behavior } = body;

      if (!BUDGET_LINE_GOAL_BEHAVIORS_BY_FREQUENCY[frequency].includes(behavior)) {
        fail({ path: 'behavior', message: `A ${frequency} goal cannot use ${behavior}.` });
      }

      if (frequency === 'weekly' && body.weekday == null) {
        fail({ path: 'weekday', message: 'A weekly goal needs a weekday.' });
      }
      if (frequency !== 'weekly' && body.weekday != null) {
        fail({ path: 'weekday', message: 'Only a weekly goal takes a weekday.' });
      }

      const anchored = BUDGET_LINE_GOAL_ANCHORED_FREQUENCIES.includes(frequency);
      if (anchored && body.anchorDate == null) {
        fail({ path: 'anchorDate', message: `A ${frequency} goal needs an anchor date.` });
      }
      if (!anchored && body.anchorDate != null) {
        fail({ path: 'anchorDate', message: `A ${frequency} goal does not take an anchor date.` });
      }

      const repeats = body.repeatEvery != null || body.repeatUnit != null;
      if (repeats) {
        if (body.repeatEvery == null || body.repeatUnit == null) {
          fail({ path: 'repeatEvery', message: 'repeatEvery and repeatUnit go together.' });
        } else if (body.repeatEvery > BUDGET_LINE_GOAL_REPEAT_MAX[body.repeatUnit]) {
          fail({
            path: 'repeatEvery',
            message: `Repeat every 1 to ${BUDGET_LINE_GOAL_REPEAT_MAX[body.repeatUnit]} ${body.repeatUnit}.`,
          });
        }
        if (frequency !== 'by_date' || behavior === 'reach_balance') {
          fail({ path: 'repeatEvery', message: 'Only a by_date budget_another or refill_up_to goal repeats.' });
        }
      }

      if (
        frequency === 'by_date' &&
        !repeats &&
        body.anchorDate != null &&
        body.anchorDate <= toUtcDateString(new Date())
      ) {
        fail({ path: 'anchorDate', message: 'The due date must be in the future.' });
      }

      if (body.stopAtBalance != null && behavior !== 'budget_another') {
        fail({ path: 'stopAtBalance', message: 'Only a budget_another goal takes stopAtBalance.' });
      }
      if (body.fundingCap != null && behavior !== 'refill_up_to') {
        fail({ path: 'fundingCap', message: 'Only a refill_up_to goal takes fundingCap.' });
      }
    }),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await setLineGoal({ userId: user.id, ...params, ...body });

  return { data };
});
