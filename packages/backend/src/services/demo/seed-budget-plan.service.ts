import type { RecordId } from '@bt/shared/types';
import type { BudgetPlanCarryPolicy, SetBudgetLineGoalPayload } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { logger } from '@js/utils/logger';
import BudgetAssignments from '@models/budget-assignments.model';
import { createLine } from '@services/budget-plans/create-line';
import { createPlan } from '@services/budget-plans/create-plan';
import { findPlan } from '@services/budget-plans/find-plan';
import { setLineGoal } from '@services/budget-plans/line-goals';
import { createGroup } from '@services/budget-plans/line-groups';
import { ensureCurrentPeriods } from '@services/budget-plans/periods/ensure-periods';

import type { DemoAccountKey } from './demo-config';
import { sumSpendByCategoryKey } from './template/budget-spend';
import type { DemoTemplate } from './template/types';

/** Closed months the plan is backdated by; amounts average over exactly those. */
const HISTORY_MONTHS = 3;

const ROUND_UP_TO_CENTS = 1000;

interface DemoBudgetLineConfig {
  name: string;
  /** A top-level key covers the whole branch. */
  categoryKeys: string[];
  /** Assigned amount as a fraction of average monthly spend; below 1 leaves the line overspent. */
  fundingRatio?: number;
  /** Rollover rule for this line; the rest follow the plan's. */
  carryPolicy?: BudgetPlanCarryPolicy;
  /** One-off amount in the last closed period, as a multiple of the usual one. */
  lastPeriodOverrideRatio?: number;
  goal?: keyof typeof GOALS;
}

/** A savings target this many months of funding away, due in as many months. */
const SAVE_BY_DATE_MONTHS = 6;

const GOALS = {
  funded_monthly: ({ amount }) => ({
    frequency: 'every_period',
    behavior: 'budget_another',
    amount: amount.toNumber(),
  }),
  refill_monthly: ({ amount }) => ({ frequency: 'every_period', behavior: 'refill_up_to', amount: amount.toNumber() }),
  save_by_date: ({ amount, monthStart }) => ({
    frequency: 'by_date',
    behavior: 'reach_balance',
    amount: amount.multiply(SAVE_BY_DATE_MONTHS).toNumber(),
    anchorDate: monthStart({ offset: SAVE_BY_DATE_MONTHS }),
  }),
} satisfies Record<
  string,
  (args: { amount: Money; monthStart: (args: { offset: number }) => string }) => SetBudgetLineGoalPayload
>;

const DEMO_BUDGET_GROUPS: { name: string; lines: DemoBudgetLineConfig[] }[] = [
  {
    name: 'Bills',
    lines: [
      { name: 'Rent', categoryKeys: ['housing/rent'], carryPolicy: 'none' },
      { name: 'Utilities', categoryKeys: ['housing/energy-utilities'] },
      { name: 'Phone & internet', categoryKeys: ['communication/internet', 'communication/phone-cell-phone'] },
      {
        name: 'Subscriptions',
        categoryKeys: ['life/tv-streaming', 'communication/software-apps-games'],
        goal: 'funded_monthly',
      },
    ],
  },
  {
    name: 'Everyday',
    lines: [
      { name: 'Groceries', categoryKeys: ['food/groceries'], fundingRatio: 1.1, goal: 'refill_monthly' },
      {
        name: 'Eating out',
        categoryKeys: ['food/restaurant', 'food/bar-cafe'],
        fundingRatio: 0.8,
        carryPolicy: 'signed',
      },
      { name: 'Transport', categoryKeys: ['transportation'] },
      { name: 'Car', categoryKeys: ['vehicle'] },
      { name: 'Shopping', categoryKeys: ['shopping'], fundingRatio: 0.9 },
    ],
  },
  {
    name: 'Life',
    lines: [
      { name: 'Health & fitness', categoryKeys: ['life/health-care-doctor', 'life/active-sport-fitness'] },
      {
        name: 'Fun',
        categoryKeys: ['life/culture-sport-events', 'life/hobbies', 'life/books-audio-subscriptions'],
        fundingRatio: 1.2,
        lastPeriodOverrideRatio: 1.5,
      },
      { name: 'Travel', categoryKeys: ['life/holiday-trips-hotels'], fundingRatio: 1.5, goal: 'save_by_date' },
    ],
  },
];

/**
 * Seeds the demo's monthly budget, backdated so closed periods already hold
 * numbers and leftovers have rolled into the current one. Amounts are the
 * average of those same closed months, so a line funded above its average is
 * certain to carry a surplus and one funded below it to end overspent.
 */
export async function setupBudgetPlan({
  userId,
  accountIds,
  categoryMap,
  template,
  currencyByAccountKey,
  referenceDate,
}: {
  userId: number;
  accountIds: string[];
  categoryMap: Map<string, string>;
  template: DemoTemplate;
  currencyByAccountKey: Partial<Record<DemoAccountKey, string>>;
  referenceDate: Date;
}): Promise<void> {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const monthStart = ({ offset }: { offset: number }) => toUtcDateString(new Date(Date.UTC(year, month + offset, 1)));
  const epochDate = monthStart({ offset: -HISTORY_MONTHS });
  const lastClosedStart = monthStart({ offset: -1 });

  // Template rows date themselves in days back from the reference date.
  const daysIntoMonth = referenceDate.getUTCDate() - 1;
  const daysSinceEpoch = Math.round(
    (Date.UTC(year, month, referenceDate.getUTCDate()) - Date.UTC(year, month - HISTORY_MONTHS, 1)) / 86_400_000,
  );
  const spendWithin = ({ windowDays }: { windowDays: number }) =>
    sumSpendByCategoryKey({ template, windowDays, currencyByAccountKey });
  const sinceEpoch = spendWithin({ windowDays: daysSinceEpoch });
  const thisMonth = spendWithin({ windowDays: daysIntoMonth });
  const spentOn = ({ key }: { key: string }) =>
    [...sinceEpoch].reduce(
      (total, [spendKey, cents]) =>
        spendKey === key || spendKey.startsWith(`${key}/`) ? total + cents - (thisMonth.get(spendKey) ?? 0) : total,
      0,
    );

  const { plan } = await createPlan({
    userId,
    name: 'Monthly budget',
    type: 'category_caps',
    cadence: 'months',
    anchorDate: epochDate,
    epochDate,
    accountIds: accountIds as RecordId[],
    carryPolicy: 'floor',
  });

  const { periods } = await ensureCurrentPeriods({ plan: await findPlan({ planId: plan.id, userId }) });
  const periodIdAt = ({ start }: { start: string }) => {
    const period = periods.find((entry) => toUtcDateString(entry.startDate) === start);
    if (!period) throw new Error(`Demo budget ${plan.id} has no period starting ${start}`);
    return period.id;
  };
  const firstPeriodId = periodIdAt({ start: epochDate });
  const lastClosedPeriodId = periodIdAt({ start: lastClosedStart });

  let created = 0;
  let skipped = 0;

  for (const groupConfig of DEMO_BUDGET_GROUPS) {
    const group = await createGroup({ userId, planId: plan.id, name: groupConfig.name });

    for (const { name, categoryKeys, fundingRatio = 1, ...extras } of groupConfig.lines) {
      const categoryIds = categoryKeys.flatMap((key) => categoryMap.get(key) ?? []);
      const monthlyCents = categoryKeys.reduce((total, key) => total + spentOn({ key }), 0) / HISTORY_MONTHS;

      if (categoryIds.length !== categoryKeys.length || monthlyCents <= 0) {
        skipped += 1;
        continue;
      }

      const line = await createLine({
        userId,
        planId: plan.id,
        name,
        categoryIds: categoryIds as RecordId[],
        groupId: group.id,
        activeFrom: epochDate,
      });
      const amount = Money.fromCents(Math.ceil((monthlyCents * fundingRatio) / ROUND_UP_TO_CENTS) * ROUND_UP_TO_CENTS);

      // A baseline and a rollover rule on the first period run on through every later one.
      await BudgetAssignments.create({
        periodId: firstPeriodId,
        lineId: line.id,
        baselineAmount: amount,
        carryPolicy: extras.carryPolicy ?? null,
      });
      if (extras.lastPeriodOverrideRatio) {
        await BudgetAssignments.create({
          periodId: lastClosedPeriodId,
          lineId: line.id,
          overrideAmount: amount.multiply(extras.lastPeriodOverrideRatio),
        });
      }
      if (extras.goal) {
        await setLineGoal({
          userId,
          planId: plan.id,
          lineId: line.id as RecordId,
          ...GOALS[extras.goal]({ amount, monthStart }),
          periodId: firstPeriodId,
        });
      }
      created += 1;
    }
  }

  // The config is static, so a skipped line means a category key or the template drifted.
  const summary = `Created demo budget with ${created} lines (skipped ${skipped} with an unknown category or no spend)`;
  if (skipped > 0) logger.error(summary);
  else logger.info(summary);
}
