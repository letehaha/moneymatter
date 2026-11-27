import { TRANSACTION_TYPES } from '@bt/shared/types';
import type { RecordId } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

type Period = { id: string; startDate: string };

const at = ({ period }: { period: Period }) => new Date(Date.parse(`${period.startDate}T12:00:00.000Z`)).toISOString();

const setup = async () => {
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
    raw: true,
  });
  const [food, fun, investments] = await Promise.all([
    helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true }),
    helpers.addCustomCategory({ name: 'Fun', color: '#222222', raw: true }),
    helpers.addCustomCategory({ name: 'Investments', color: '#333333', raw: true }),
  ]);
  const games = await helpers.addCustomCategory({ name: 'Games', color: '#444444', parentId: fun.id, raw: true });

  const { plan } = await helpers.createBudgetPlan({
    payload: { accountIds: [account.id], epochDate: helpers.budgetPeriodStart({ monthsAgo: 1 }), poolEnabled: true },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
  await helpers.createBudgetPlanLine({
    planId: plan.id,
    payload: { name: 'Food', categoryIds: [food.id], activeFrom: periods[0]!.startDate },
    raw: true,
  });

  return { account, fun, games, investments, plan, planId: plan.id, period: periods[0]! };
};

const expense = ({
  accountId,
  categoryId,
  amount,
  period,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  period: Period;
}) =>
  helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId, categoryId, amount, transactionType: TRANSACTION_TYPES.expense }),
      time: at({ period }),
    },
    raw: true,
  });

const view = ({ planId, period }: { planId: string; period: Period }) =>
  helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true });

describe('Budget plan ignored categories', () => {
  it('starts empty and lists every uncovered category', async () => {
    const { account, plan, planId, period, fun, investments } = await setup();
    await expense({ accountId: account.id, categoryId: fun.id, amount: 20, period });
    await expense({ accountId: account.id, categoryId: investments.id, amount: 300, period });

    expect(plan.ignoredCategoryIds).toEqual([]);
    const result = await view({ planId, period });
    expect(result.unbudgeted.toSorted((a, b) => a.activity - b.activity)).toEqual([
      { categoryId: investments.id, activity: -300 },
      { categoryId: fun.id, activity: -20 },
    ]);
  });

  it('hides an ignored category from unbudgeted while its spending still lowers the pool', async () => {
    const { account, planId, period, fun, investments } = await setup();
    await expense({ accountId: account.id, categoryId: fun.id, amount: 20, period });
    await expense({ accountId: account.id, categoryId: investments.id, amount: 300, period });

    const updated = await helpers.updateBudgetPlan({
      planId,
      payload: { ignoredCategoryIds: [investments.id] },
      raw: true,
    });
    expect(updated.plan.ignoredCategoryIds).toEqual([investments.id]);

    const result = await view({ planId, period });
    expect(result.unbudgeted).toEqual([{ categoryId: fun.id, activity: -20 }]);
    expect(result.pool!.flow.outsideSpending).toBe(-320);
  });

  it('hides only the ignored child share of a root category', async () => {
    const { account, planId, period, fun, games } = await setup();
    await expense({ accountId: account.id, categoryId: fun.id, amount: 20, period });
    await expense({ accountId: account.id, categoryId: games.id, amount: 50, period });

    await helpers.updateBudgetPlan({ planId, payload: { ignoredCategoryIds: [games.id] }, raw: true });

    expect((await view({ planId, period })).unbudgeted).toEqual([{ categoryId: fun.id, activity: -20 }]);

    await helpers.updateBudgetPlan({ planId, payload: { ignoredCategoryIds: [] }, raw: true });

    expect((await view({ planId, period })).unbudgeted).toEqual([{ categoryId: fun.id, activity: -70 }]);
  });

  it('hides the spending of every child of an ignored parent', async () => {
    const { account, planId, period, fun, games } = await setup();
    await expense({ accountId: account.id, categoryId: games.id, amount: 50, period });

    await helpers.updateBudgetPlan({ planId, payload: { ignoredCategoryIds: [fun.id] }, raw: true });

    const result = await view({ planId, period });
    expect(result.unbudgeted).toEqual([]);
    expect(result.pool!.flow.outsideSpending).toBe(-50);
  });

  it('rejects a category the plan owner does not have', async () => {
    const { planId } = await setup();

    const response = await helpers.updateBudgetPlan({
      planId,
      payload: { ignoredCategoryIds: [generateRandomRecordId()] },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('drops a deleted category from the ignored list', async () => {
    const { planId, fun, investments } = await setup();
    await helpers.updateBudgetPlan({ planId, payload: { ignoredCategoryIds: [fun.id, investments.id] }, raw: true });

    await helpers.deleteCustomCategory({ categoryId: investments.id });

    const details = await helpers.getBudgetPlan({ planId, raw: true });
    expect(details.plan.ignoredCategoryIds).toEqual([fun.id]);
  });

  it('moves the ignore to the replacement when a category is deleted into another', async () => {
    const { planId, fun, investments } = await setup();
    await helpers.updateBudgetPlan({ planId, payload: { ignoredCategoryIds: [investments.id] }, raw: true });

    await helpers.deleteCustomCategory({ categoryId: investments.id, replaceWithCategoryId: fun.id });

    const details = await helpers.getBudgetPlan({ planId, raw: true });
    expect(details.plan.ignoredCategoryIds).toEqual([fun.id]);
  });
});
