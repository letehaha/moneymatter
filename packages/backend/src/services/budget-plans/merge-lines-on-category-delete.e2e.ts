import { TRANSACTION_TYPES } from '@bt/shared/types';
import type { RecordId } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import BudgetPeriods from '@models/budget-periods.model';
import * as helpers from '@tests/helpers';

type Period = { id: string; startDate: string; endDate: string };

const setup = async ({ monthsAgo = 2 }: { monthsAgo?: number } = {}) => {
  const account = await helpers.createAccount({ raw: true });
  const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });
  const [groceries, restaurants, transport, bills] = await Promise.all([
    helpers.addCustomCategory({ name: 'Groceries', color: '#222222', parentId: food.id, raw: true }),
    helpers.addCustomCategory({ name: 'Restaurants', color: '#333333', parentId: food.id, raw: true }),
    helpers.addCustomCategory({ name: 'Transport', color: '#444444', raw: true }),
    helpers.addCustomCategory({ name: 'Bills', color: '#555555', raw: true }),
  ]);

  const { plan } = await helpers.createBudgetPlan({
    payload: { accountIds: [account.id], epochDate: helpers.budgetPeriodStart({ monthsAgo }) },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });

  return { account, food, groceries, restaurants, transport, bills, planId: plan.id, periods };
};

const addLine = ({
  planId,
  name,
  categoryIds,
  activeFrom,
}: {
  planId: string;
  name: string;
  categoryIds: RecordId[];
  activeFrom?: string;
}) => helpers.createBudgetPlanLine({ planId, payload: { name, categoryIds, activeFrom }, raw: true });

const assign = ({
  planId,
  periodId,
  lineId,
  amount,
  carryPolicy,
}: {
  planId: string;
  periodId: string;
  lineId: string;
  amount?: number;
  carryPolicy?: 'none' | 'floor' | 'signed';
}) =>
  helpers.setBudgetAssignment({
    planId,
    periodId,
    lineId,
    payload: { scope: 'from_here', amount, carryPolicy },
    raw: true,
  });

const deleteCategory = async ({
  categoryId,
  replaceWithCategoryId,
}: {
  categoryId: string;
  replaceWithCategoryId?: string;
}) => {
  const response = await helpers.deleteCustomCategory({ categoryId, replaceWithCategoryId, raw: false });
  expect(response.status).toBe(200);
};

const view = ({ planId, period }: { planId: string; period: Period }) =>
  helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true });

const headers = ({ planId, periods }: { planId: string; periods: Period[] }) =>
  Promise.all(periods.map(async (period) => (await view({ planId, period })).header));

const lineNamed = async ({ planId, period, name }: { planId: string; period: Period; name: string }) =>
  (await view({ planId, period })).lines.find((line) => line.name === name);

describe('Category delete: budget line merge', () => {
  it('drops the membership row and hard-deletes a line that never closed a period', async () => {
    const { planId, transport, periods } = await setup({ monthsAgo: 0 });
    const line = await addLine({ planId, name: 'Transport', categoryIds: [transport.id] });
    await assign({ planId, periodId: periods[0]!.id, lineId: line.id, amount: 100 });

    await deleteCategory({ categoryId: transport.id });

    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([]);
  });

  it('archives an emptied line from the current period and leaves its closed periods owned', async () => {
    const { planId, transport, periods } = await setup();
    const line = await addLine({
      planId,
      name: 'Transport',
      categoryIds: [transport.id],
      activeFrom: periods[0]!.startDate,
    });
    await assign({ planId, periodId: periods[0]!.id, lineId: line.id, amount: 100 });

    await deleteCategory({ categoryId: transport.id });

    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([
      { ...line, activeUntil: periods[2]!.startDate, categoryIds: [] },
    ]);
    expect(await lineNamed({ planId, period: periods[0]!, name: 'Transport' })).toMatchObject({ assigned: 100 });
    expect(await lineNamed({ planId, period: periods[2]!, name: 'Transport' })).toBeUndefined();
  });

  it('swaps the leaf for its parent and leaves a sibling line with its own spending', async () => {
    const { planId, account, food, groceries, restaurants, periods } = await setup();
    const groceriesLine = await addLine({
      planId,
      name: 'Groceries',
      categoryIds: [groceries.id],
      activeFrom: periods[0]!.startDate,
    });
    await addLine({ planId, name: 'Restaurants', categoryIds: [restaurants.id], activeFrom: periods[0]!.startDate });
    await assign({ planId, periodId: periods[0]!.id, lineId: groceriesLine.id, amount: 300 });

    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 40,
          categoryId: restaurants.id,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        time: `${periods[0]!.startDate}T12:00:00.000Z`,
      },
      raw: true,
    });

    await deleteCategory({ categoryId: groceries.id, replaceWithCategoryId: food.id });

    const result = await view({ planId, period: periods[0]! });
    expect(
      result.lines
        .map((line) => [line.name, line.categoryIds, line.assigned, line.activity])
        .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['Groceries', [food.id], 300, 0],
      ['Restaurants', [restaurants.id], 0, -40],
    ]);
  });

  it('drops the row when the line already covers the replacement, keeping its other categories', async () => {
    const { planId, food, transport, periods } = await setup();
    const line = await addLine({
      planId,
      name: 'Both',
      categoryIds: [food.id, transport.id],
      activeFrom: periods[0]!.startDate,
    });
    await assign({ planId, periodId: periods[0]!.id, lineId: line.id, amount: 250 });

    await deleteCategory({ categoryId: transport.id, replaceWithCategoryId: food.id });

    expect(await lineNamed({ planId, period: periods[0]!, name: 'Both' })).toMatchObject({
      categoryIds: [food.id],
      assigned: 250,
    });
  });

  it('drops the row when another line holds the replacement, keeping the line and its amounts', async () => {
    const { planId, groceries, transport, bills, periods } = await setup();
    const mixed = await addLine({
      planId,
      name: 'Mixed',
      categoryIds: [groceries.id, transport.id],
      activeFrom: periods[0]!.startDate,
    });
    await addLine({ planId, name: 'Bills', categoryIds: [bills.id], activeFrom: periods[0]!.startDate });
    await assign({ planId, periodId: periods[0]!.id, lineId: mixed.id, amount: 180 });

    await deleteCategory({ categoryId: groceries.id, replaceWithCategoryId: bills.id });

    expect(await lineNamed({ planId, period: periods[0]!, name: 'Mixed' })).toMatchObject({
      categoryIds: [transport.id],
      assigned: 180,
    });
  });

  it('merges an emptied line into the line holding the replacement, keeping Σ assigned per period', async () => {
    const { planId, groceries, transport, periods } = await setup();
    const source = await addLine({
      planId,
      name: 'Groceries',
      categoryIds: [groceries.id],
      activeFrom: periods[0]!.startDate,
    });
    const target = await addLine({
      planId,
      name: 'Transport',
      categoryIds: [transport.id],
      activeFrom: periods[0]!.startDate,
    });
    await assign({ planId, periodId: periods[0]!.id, lineId: source.id, amount: 100 });
    await assign({ planId, periodId: periods[1]!.id, lineId: source.id, amount: 150 });
    await assign({ planId, periodId: periods[0]!.id, lineId: target.id, amount: 200 });

    const before = await headers({ planId, periods });

    await deleteCategory({ categoryId: groceries.id, replaceWithCategoryId: transport.id });

    expect(await headers({ planId, periods })).toEqual(before);
    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines.map((line) => line.name)).toEqual(['Transport']);
    expect(await Promise.all(periods.map((period) => lineNamed({ planId, period, name: 'Transport' })))).toMatchObject([
      { assigned: 300 },
      { assigned: 350 },
      { assigned: 350 },
    ]);
  });

  it('stops the merged baseline after an archived line lifetime', async () => {
    const { planId, groceries, transport, periods } = await setup();
    const source = await addLine({
      planId,
      name: 'Groceries',
      categoryIds: [groceries.id],
      activeFrom: periods[0]!.startDate,
    });
    const target = await addLine({
      planId,
      name: 'Transport',
      categoryIds: [transport.id],
      activeFrom: periods[0]!.startDate,
    });
    await assign({ planId, periodId: periods[0]!.id, lineId: source.id, amount: 100 });
    await assign({ planId, periodId: periods[0]!.id, lineId: target.id, amount: 200 });
    await helpers.archiveBudgetPlanLine({ planId, lineId: source.id });

    const before = await headers({ planId, periods });

    await deleteCategory({ categoryId: groceries.id, replaceWithCategoryId: transport.id });

    expect(await headers({ planId, periods })).toEqual(before);
    expect(await Promise.all(periods.map((period) => lineNamed({ planId, period, name: 'Transport' })))).toMatchObject([
      { assigned: 300 },
      { assigned: 300 },
      { assigned: 200 },
    ]);
  });

  it('keeps Σ assigned but not Σ available when a floor line is merged away', async () => {
    const { planId, groceries, transport, periods } = await setup();
    const source = await addLine({
      planId,
      name: 'Groceries',
      categoryIds: [groceries.id],
      activeFrom: periods[0]!.startDate,
    });
    const target = await addLine({
      planId,
      name: 'Transport',
      categoryIds: [transport.id],
      activeFrom: periods[0]!.startDate,
    });
    await assign({ planId, periodId: periods[0]!.id, lineId: source.id, amount: 100, carryPolicy: 'floor' });
    await assign({ planId, periodId: periods[0]!.id, lineId: target.id, amount: 200 });

    expect(await headers({ planId, periods })).toMatchObject([
      { totalAssigned: 300, totalAvailable: 300 },
      { totalAssigned: 300, totalAvailable: 400 },
      { totalAssigned: 300, totalAvailable: 500 },
    ]);

    await deleteCategory({ categoryId: groceries.id, replaceWithCategoryId: transport.id });

    expect(await headers({ planId, periods })).toMatchObject([
      { totalAssigned: 300, totalAvailable: 300 },
      { totalAssigned: 300, totalAvailable: 300 },
      { totalAssigned: 300, totalAvailable: 300 },
    ]);
  });

  it('merges the lines of a soft-deleted plan too', async () => {
    const { planId, groceries, transport, periods } = await setup();
    const source = await addLine({
      planId,
      name: 'Groceries',
      categoryIds: [groceries.id],
      activeFrom: periods[0]!.startDate,
    });
    const target = await addLine({
      planId,
      name: 'Transport',
      categoryIds: [transport.id],
      activeFrom: periods[0]!.startDate,
    });
    await assign({ planId, periodId: periods[0]!.id, lineId: source.id, amount: 100 });
    await assign({ planId, periodId: periods[0]!.id, lineId: target.id, amount: 200 });

    await helpers.deleteBudgetPlan({ planId });
    await deleteCategory({ categoryId: groceries.id, replaceWithCategoryId: transport.id });
    await helpers.restoreBudgetPlan({ planId, raw: true });

    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines.map((line) => line.name)).toEqual(['Transport']);
    expect(await lineNamed({ planId, period: periods[0]!, name: 'Transport' })).toMatchObject({ assigned: 300 });
  });

  it('keeps a closed period owned when the stored periods of a trashed plan lag behind today', async () => {
    const { planId, transport, periods } = await setup();
    const line = await addLine({
      planId,
      name: 'Transport',
      categoryIds: [transport.id],
      activeFrom: periods[0]!.startDate,
    });
    await assign({ planId, periodId: periods[1]!.id, lineId: line.id, amount: 120 });

    await helpers.deleteBudgetPlan({ planId });
    // A trashed plan gets no new periods, so dropping the newest stored one puts
    // today past every stored period, as a boundary crossed in the trash would.
    await BudgetPeriods.destroy({ where: { id: periods[2]!.id } });

    await deleteCategory({ categoryId: transport.id });
    await helpers.restoreBudgetPlan({ planId, raw: true });

    expect(await lineNamed({ planId, period: periods[1]!, name: 'Transport' })).toMatchObject({ assigned: 120 });
  });

  it('leaves a user without a plan untouched', async () => {
    const transport = await helpers.addCustomCategory({ name: 'Transport', color: '#444444', raw: true });

    await deleteCategory({ categoryId: transport.id });
  });
});
