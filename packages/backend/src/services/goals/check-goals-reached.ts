import { toGoalCurrency } from '@bt/shared/goals/goal-math';
import {
  type GoalModel,
  type GoalReachedNotificationPayload,
  NOTIFICATION_TYPES,
  type RecordId,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import Goals from '@models/goals.model';
import { withTransaction } from '@services/common/with-transaction';
import * as notificationsService from '@services/notifications';
import { subDays } from 'date-fns';
import { Op } from 'sequelize';

import { getGoal, loadGoalsWithInsights, throwGoalNotFound } from './get-goals';

/** A latch younger than this survives the goal dipping below target, so an oscillating balance can't re-notify. */
const REARM_AFTER_DAYS = 30;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The `achievedAt: null` guard makes the claim atomic: a concurrent run updates 0 rows and sends nothing. */
const latchGoal = withTransaction(
  async ({
    userId,
    goal,
    achievedAt,
    achievedAmount,
  }: {
    userId: number;
    goal: GoalModel;
    achievedAt: Date;
    achievedAmount: Money;
  }): Promise<boolean> => {
    const [claimed] = await Goals.update(
      { achievedAt, achievedAmount },
      { where: { id: goal.id, userId, achievedAt: null } },
    );
    if (!claimed) return false;

    const amount = achievedAmount.toNumber();
    await notificationsService.createNotification({
      userId,
      type: NOTIFICATION_TYPES.goalReached,
      title: t({ key: 'goals.reachedNotification.title', variables: { name: goal.name } }),
      message: t({
        key: 'goals.reachedNotification.message',
        variables: { amount, currencyCode: goal.currencyCode },
      }),
      payload: {
        goalId: goal.id,
        goalName: goal.name,
        achievedAmount: amount,
        currencyCode: goal.currencyCode,
      } satisfies GoalReachedNotificationPayload,
    });
    return true;
  },
);

/**
 * Owns the `achievedAt` / `achievedAmount` latch: sets it (one notification) when a goal
 * reaches its target, clears it once the goal has been below target past the re-arm window.
 */
const syncGoalAchievement = async ({
  userId,
  goalIds,
}: {
  userId: number;
  goalIds?: RecordId[];
}): Promise<{ goals: GoalModel[]; notified: number; errors: string[] }> => {
  const goals = await loadGoalsWithInsights({ userId, goalIds });
  const now = new Date();
  const rearmBefore = subDays(now, REARM_AFTER_DAYS);
  let notified = 0;
  const errors: string[] = [];

  for (const goal of goals) {
    if (goal.status === 'archived') continue;
    if (!goal.insights) {
      logger.warn('[Goals] Reached check skipped: no insights, reached notification withheld', { goalId: goal.id });
      continue;
    }

    try {
      if (goal.insights.status === 'reached') {
        if (goal.achievedAt) continue;
        const achievedAmount = Money.fromDecimal(
          toGoalCurrency({ amount: goal.insights.currentValue, rateToBase: goal.insights.rateToBase }),
        );
        if (await latchGoal({ userId, goal, achievedAt: now, achievedAmount })) {
          goal.achievedAt = now.toISOString();
          goal.achievedAmount = achievedAmount.toNumber();
          notified += 1;
        }
      } else if (goal.achievedAt && new Date(goal.achievedAt) < rearmBefore) {
        // Matching the read `achievedAt` keeps a concurrent re-latch from being wiped.
        const [rearmed] = await Goals.update(
          { achievedAt: null, achievedAmount: null },
          { where: { id: goal.id, userId, achievedAt: new Date(goal.achievedAt) } },
        );
        if (rearmed) {
          goal.achievedAt = null;
          goal.achievedAmount = null;
        }
      }
    } catch (error) {
      errors.push(`goal ${goal.id}: ${errorMessage(error)}`);
      logger.error(
        { message: `Goal achievement sync failed for goal ${goal.id}`, error: error as Error },
        { code: 'GOAL_ACHIEVEMENT_SYNC_FAILED', goalId: goal.id },
      );
    }
  }

  return { goals, notified, errors };
};

/** Runs after the write commits, so a sync failure is logged instead of failing the saved write. */
export const syncSavedGoal = async ({ userId, goalId }: { userId: number; goalId: RecordId }): Promise<GoalModel> => {
  const synced = await syncGoalAchievement({ userId, goalIds: [goalId] }).catch((error: unknown) => {
    logger.error(
      { message: `Goal achievement sync failed for goal ${goalId}`, error: error as Error },
      { code: 'GOAL_ACHIEVEMENT_SYNC_FAILED', goalId },
    );
    return null;
  });
  if (!synced) return getGoal({ userId, goalId });
  return synced.goals[0] ?? throwGoalNotFound();
};

export const checkGoalsReached = async () => {
  const rows = await Goals.findAll({
    where: { status: { [Op.ne]: 'archived' } },
    attributes: ['userId'],
    group: ['userId'],
  });
  const result = { usersChecked: rows.length, notified: 0, failed: 0, errors: [] as string[] };

  for (const { userId } of rows) {
    try {
      const { notified, errors } = await syncGoalAchievement({ userId });
      result.notified += notified;
      result.failed += errors.length;
      result.errors.push(...errors);
    } catch (error) {
      result.failed += 1;
      result.errors.push(`user ${userId}: ${errorMessage(error)}`);
      logger.error(
        { message: `Goals reached check failed for user ${userId}`, error: error as Error },
        { code: 'GOALS_REACHED_CHECK_USER_FAILED' },
      );
    }
  }

  if (result.failed > 0) {
    logger.error(`Goals reached check finished with ${result.failed} failures`, {
      code: 'GOALS_REACHED_CHECK_PARTIAL_FAILURE',
      usersChecked: result.usersChecked,
      notified: result.notified,
    });
  }

  return result;
};
