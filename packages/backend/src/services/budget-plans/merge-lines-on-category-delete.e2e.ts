import { TRANSACTION_TYPES } from '@bt/shared/types';
import type { RecordId } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BudgetPeriods from '@models/budget-periods.model';
import * as helpers from '@tests/helpers';
import { Op } from 'sequelize';

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
  // Epoch through current: the per-period assertions below list exactly these.
  const throughCurrent = periods.slice(0, periods.findIndex((period) => period.isCurrent) + 1);

  return { account, food, groceries, restaurants, transport, bills, planId: plan.id, periods: throughCurrent };
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

const spend = ({
  accountId,
  categoryId,
  period,
  amount,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  period: Period;
  amount: number;
}) =>
  helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount,
      categoryId,
      transactionType: TRANSACTION_TYPES.expense,
      time: `${period.startDate}T12:00:00.000Z`,
    }),
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

const lineByPeriod = ({ planId, periods, name }: { planId: string; periods: Period[]; name: string }) =>
  Promise.all(periods.map((period) => lineNamed({ planId, period, name })));

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

    await spend({ accountId: account.id, categoryId: restaurants.id, period: periods[0]!, amount: 40 });

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

  it('lets both lines of the swapped ancestor pair be edited, but refuses a newly overlapping category', async () => {
    const { planId, food, groceries, restaurants, periods } = await setup();
    const groceriesLine = await addLine({
      planId,
      name: 'Groceries',
      categoryIds: [groceries.id],
      activeFrom: periods[0]!.startDate,
    });
    const restaurantsLine = await addLine({
      planId,
      name: 'Restaurants',
      categoryIds: [restaurants.id],
      activeFrom: periods[0]!.startDate,
    });

    await deleteCategory({ categoryId: groceries.id, replaceWithCategoryId: food.id });

    const edit = ({ lineId, name, categoryIds }: { lineId: string; name: string; categoryIds: RecordId[] }) =>
      helpers.updateBudgetPlanLine({ planId, lineId, payload: { name, categoryIds } });

    expect((await edit({ lineId: groceriesLine.id, name: 'Food', categoryIds: [food.id] })).statusCode).toBe(200);
    expect(
      (await edit({ lineId: restaurantsLine.id, name: 'Eating out', categoryIds: [restaurants.id] })).statusCode,
    ).toBe(200);
    expect((await edit({ lineId: restaurantsLine.id, name: 'Eating out', categoryIds: [food.id] })).statusCode).toBe(
      ERROR_CODES.ConflictError,
    );
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

  it('collapses a descendant of the replacement inside the same line into the replacement', async () => {
    const { planId, food, groceries, transport, periods } = await setup();
    const line = await addLine({
      planId,
      name: 'Mixed',
      categoryIds: [transport.id, groceries.id],
      activeFrom: periods[0]!.startDate,
    });
    await assign({ planId, periodId: periods[0]!.id, lineId: line.id, amount: 120 });

    await deleteCategory({ categoryId: transport.id, replaceWithCategoryId: food.id });

    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([{ ...line, categoryIds: [food.id] }]);
    expect(await lineNamed({ planId, period: periods[0]!, name: 'Mixed' })).toMatchObject({
      categoryIds: [food.id],
      assigned: 120,
    });
  });

  it('keeps a descendant on the periods before the replacement joined the line', async () => {
    const { planId, food, groceries, transport, periods } = await setup();
    const line = await addLine({
      planId,
      name: 'Groceries',
      categoryIds: [groceries.id],
      activeFrom: periods[0]!.startDate,
    });
    await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [groceries.id, transport.id], effectiveFrom: periods[1]!.startDate },
      raw: true,
    });

    await deleteCategory({ categoryId: transport.id, replaceWithCategoryId: food.id });

    const categoryIds = await Promise.all(
      periods.map(async (period) => (await lineNamed({ planId, period, name: 'Groceries' }))?.categoryIds),
    );
    expect(categoryIds).toEqual([[groceries.id], [food.id], [food.id]]);
  });

  it('swaps the periods before the replacement joined the same line, keeping their spending on it', async () => {
    const { planId, account, food, transport, periods } = await setup();
    const line = await addLine({
      planId,
      name: 'Mixed',
      categoryIds: [transport.id],
      activeFrom: periods[0]!.startDate,
    });
    await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [transport.id, food.id], effectiveFrom: periods[1]!.startDate },
      raw: true,
    });
    await spend({ accountId: account.id, categoryId: transport.id, period: periods[0]!, amount: 40 });

    await deleteCategory({ categoryId: transport.id, replaceWithCategoryId: food.id });

    expect(
      (await lineByPeriod({ planId, periods, name: 'Mixed' })).map((entry) => [entry?.categoryIds, entry?.activity]),
    ).toEqual([
      [[food.id], -40],
      [[food.id], 0],
      [[food.id], 0],
    ]);
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

  it('swaps the periods before another line took the replacement and merges the later amounts into it', async () => {
    const { planId, account, groceries, transport, periods } = await setup();
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
      activeFrom: periods[1]!.startDate,
    });
    await assign({ planId, periodId: periods[0]!.id, lineId: source.id, amount: 100 });
    await assign({ planId, periodId: periods[1]!.id, lineId: target.id, amount: 50 });
    await spend({ accountId: account.id, categoryId: groceries.id, period: periods[0]!, amount: 40 });

    const before = await headers({ planId, periods });

    await deleteCategory({ categoryId: groceries.id, replaceWithCategoryId: transport.id });

    expect(await headers({ planId, periods })).toEqual(before);
    expect(
      (await lineByPeriod({ planId, periods, name: 'Groceries' })).map(
        (entry) => entry && [entry.categoryIds, entry.assigned, entry.activity],
      ),
    ).toEqual([[[transport.id], 100, -40], [[], 0, 0], undefined]);
    expect((await lineByPeriod({ planId, periods, name: 'Transport' })).map((entry) => entry?.assigned)).toEqual([
      undefined,
      150,
      150,
    ]);
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
    expect(await lineByPeriod({ planId, periods, name: 'Transport' })).toMatchObject([
      { assigned: 300 },
      { assigned: 350 },
      { assigned: 350 },
    ]);
  });

  it('keeps the amounts of a closed middle period on the emptied line it merges', async () => {
    const { planId, groceries, transport, bills, periods } = await setup();
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
    const edit = ({ categoryIds, effectiveFrom }: { categoryIds: RecordId[]; effectiveFrom?: string }) =>
      helpers.updateBudgetPlanLine({ planId, lineId: source.id, payload: { categoryIds, effectiveFrom }, raw: true });
    await edit({ categoryIds: [groceries.id, bills.id], effectiveFrom: periods[1]!.startDate });
    await edit({ categoryIds: [groceries.id] });
    await assign({ planId, periodId: periods[0]!.id, lineId: source.id, amount: 100 });
    await assign({ planId, periodId: periods[0]!.id, lineId: target.id, amount: 50 });

    const before = await headers({ planId, periods });

    await deleteCategory({ categoryId: groceries.id, replaceWithCategoryId: transport.id });

    expect(await headers({ planId, periods })).toEqual(before);
    expect(
      (await lineByPeriod({ planId, periods, name: 'Groceries' })).map(
        (entry) => entry && [entry.categoryIds, entry.assigned],
      ),
    ).toEqual([[[], 0], [[bills.id], 100], undefined]);
    expect((await lineByPeriod({ planId, periods, name: 'Transport' })).map((entry) => entry?.assigned)).toEqual([
      150, 50, 150,
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
    expect(await lineByPeriod({ planId, periods, name: 'Transport' })).toMatchObject([
      { assigned: 300 },
      { assigned: 300 },
      { assigned: 200 },
    ]);
  });

  it('merges an emptied line into an archived and a live line that held the replacement in turn', async () => {
    const { planId, groceries, transport, periods } = await setup();
    const source = await addLine({
      planId,
      name: 'Groceries',
      categoryIds: [groceries.id],
      activeFrom: periods[0]!.startDate,
    });
    const archived = await addLine({
      planId,
      name: 'Old transport',
      categoryIds: [transport.id],
      activeFrom: periods[0]!.startDate,
    });
    await assign({ planId, periodId: periods[0]!.id, lineId: source.id, amount: 100 });
    await assign({ planId, periodId: periods[0]!.id, lineId: archived.id, amount: 200 });
    await helpers.archiveBudgetPlanLine({ planId, lineId: archived.id });
    const live = await addLine({ planId, name: 'Transport', categoryIds: [transport.id] });
    await assign({ planId, periodId: periods[2]!.id, lineId: live.id, amount: 50 });

    const before = await headers({ planId, periods });

    await deleteCategory({ categoryId: groceries.id, replaceWithCategoryId: transport.id });

    expect(await headers({ planId, periods })).toEqual(before);
    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines.map((line) => line.name).toSorted()).toEqual([
      'Old transport',
      'Transport',
    ]);
    expect((await lineByPeriod({ planId, periods, name: 'Old transport' })).map((entry) => entry?.assigned)).toEqual([
      300,
      300,
      undefined,
    ]);
    expect((await lineByPeriod({ planId, periods, name: 'Transport' })).map((entry) => entry?.assigned)).toEqual([
      undefined,
      undefined,
      150,
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
    // A trashed plan gets no new periods, so dropping the current and later ones
    // puts today past every stored period, as a long stay in the trash would.
    await BudgetPeriods.destroy({ where: { planId, startDate: { [Op.gte]: periods[2]!.startDate } } });

    await deleteCategory({ categoryId: transport.id });
    await helpers.restoreBudgetPlan({ planId, raw: true });

    expect(await lineNamed({ planId, period: periods[1]!, name: 'Transport' })).toMatchObject({ assigned: 120 });
  });

  it('leaves a user without a plan untouched', async () => {
    const transport = await helpers.addCustomCategory({ name: 'Transport', color: '#444444', raw: true });

    await deleteCategory({ categoryId: transport.id });

    expect(await helpers.listBudgetPlans({ includeDeleted: true, raw: true })).toEqual([]);
  });
});
