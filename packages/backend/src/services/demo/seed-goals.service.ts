import type { RecordId } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import { createGoal } from '@services/goals/create-goal';
import { addMonths, format } from 'date-fns';

/**
 * Goals backed by shares of the savings account. Targets scale off the seeded balance, which
 * varies per template, so a `progress` of 1 or less always reads as reached and above 1 as in progress.
 */
const DEMO_GOALS = [
  { name: 'Emergency fund', sharePercent: 40, progress: 1, icon: 'shield-checkmark-24-regular', color: '#22c55e' },
  { name: 'New laptop', sharePercent: 15, progress: 1, icon: 'laptop-24-regular', color: '#6366f1' },
  {
    name: 'Trip to Japan',
    sharePercent: 30,
    progress: 1.6,
    months: 6,
    icon: 'airplane-24-regular',
    color: '#f59e0b',
  },
  {
    name: 'Car down payment',
    sharePercent: 15,
    progress: 4,
    months: 18,
    icon: 'vehicle-car-24-regular',
    color: '#0ea5e9',
  },
];

export async function setupGoals({
  userId,
  savingsAccountId,
  referenceDate,
}: {
  userId: number;
  savingsAccountId: string;
  referenceDate: Date;
}): Promise<void> {
  const savings = await Accounts.findOne({ where: { id: savingsAccountId, userId } });
  if (!savings) throw new Error(`Demo savings account ${savingsAccountId} not found`);
  const balance = savings.currentBalance.toNumber();

  for (const [sortOrder, goal] of DEMO_GOALS.entries()) {
    const saved = (balance * goal.sharePercent) / 100;
    const targetAmount = Math.floor((saved * goal.progress) / 100) * 100;

    await createGoal({
      userId,
      name: goal.name,
      currencyCode: savings.currencyCode,
      targetAmount,
      targetDate: goal.months ? format(addMonths(referenceDate, goal.months), 'yyyy-MM-dd') : null,
      plannedMonthly: goal.months ? Math.ceil((targetAmount - saved) / goal.months) : null,
      sortOrder,
      accounts: [{ accountId: savingsAccountId as RecordId, sharePercent: goal.sharePercent }],
      logoIcon: goal.icon,
      logoColor: goal.color,
    });
  }

  logger.info(`Created ${DEMO_GOALS.length} demo goals for user ${userId}`);
}
