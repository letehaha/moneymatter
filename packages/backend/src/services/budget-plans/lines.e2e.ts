import { EARLY_ADOPTER_BUDGET_TRIAL_DAYS, PLANS, TRANSACTION_TYPES } from '@bt/shared/types';
import type { RecordId } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { toUtcDateString } from '@common/utils/date';
import { describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import * as helpers from '@tests/helpers';

import { MS_PER_DAY } from './periods/period-enumerator';

const CURRENT = helpers.budgetPeriodStart();
const PREVIOUS = helpers.budgetPeriodStart({ monthsAgo: 1 });
const BACKDATED = helpers.budgetPeriodStart({ monthsAgo: 2 });
const NEXT = helpers.budgetPeriodStart({ monthsAgo: -1 });
const THREE_AGO = helpers.budgetPeriodStart({ monthsAgo: 3 });

const setup = async ({ monthsAgo = 0 }: { monthsAgo?: number } = {}) => {
  const created = await helpers.createBudgetPlan({
    payload: monthsAgo ? { epochDate: helpers.budgetPeriodStart({ monthsAgo }) } : {},
    raw: true,
  });
  const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });
  const [groceries, transport] = await Promise.all([
    helpers.addCustomCategory({ name: 'Groceries', color: '#222222', parentId: food.id, raw: true }),
    helpers.addCustomCategory({ name: 'Transport', color: '#333333', raw: true }),
  ]);

  return { planId: created.plan.id, food, groceries, transport };
};

/** Read-only peek at stored ranges: there is no endpoint that exposes them yet. */
const membershipRanges = async ({ lineId }: { lineId: string }) => {
  const rows = await BudgetLineCategories.findAll({ where: { lineId }, order: [['fromDate', 'ASC']] });

  return rows.map((row) => ({
    categoryId: row.categoryId,
    fromDate: toUtcDateString(row.fromDate),
    untilDate: row.untilDate === null ? null : toUtcDateString(row.untilDate),
  }));
};

describe('Budget plan line create', () => {
  it('starts the line in the current period, not the last stored one, and returns its categories there', async () => {
    const { planId, food } = await setup();
    const periods = await helpers.listBudgetPlanPeriods({ planId, raw: true });
    expect(periods.at(-1)!.startDate > CURRENT).toBe(true);

    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: ' Food ', categoryIds: [food.id], sortOrder: 3 },
      raw: true,
    });

    expect(line).toEqual({
      id: expect.any(String),
      name: 'Food',
      sortOrder: 3,
      activeFrom: CURRENT,
      activeUntil: null,
      categoryIds: [food.id],
      groupId: null,
    });
    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([line]);
  });

  it('accepts a backdated period start and refuses any other date', async () => {
    const { planId, food, transport } = await setup({ monthsAgo: 2 });

    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });
    expect(line.activeFrom).toBe(BACKDATED);

    for (const activeFrom of [helpers.budgetPeriodStart({ monthsAgo: 3 }), NEXT, `${CURRENT.slice(0, 8)}15`]) {
      const response = await helpers.createBudgetPlanLine({
        planId,
        payload: { name: 'Other', categoryIds: [transport.id], activeFrom },
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    }
  });

  it('refuses a category the user does not own, and an empty list', async () => {
    const { planId } = await setup();
    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const foreign = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.addCustomCategory({ name: 'Foreign', color: '#555555', raw: true }),
    });

    for (const categoryId of [generateRandomRecordId(), foreign.id]) {
      expect(
        (await helpers.createBudgetPlanLine({ planId, payload: { name: 'X', categoryIds: [categoryId] } })).statusCode,
      ).toBe(ERROR_CODES.ValidationError);
    }
    expect((await helpers.createBudgetPlanLine({ planId, payload: { name: 'X', categoryIds: [] } })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
  });

  it('collapses a parent and its child inside one line into the parent', async () => {
    const { planId, food, groceries } = await setup();

    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Both', categoryIds: [food.id, groceries.id] },
      raw: true,
    });

    expect(line.categoryIds).toEqual([food.id]);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: CURRENT, untilDate: null },
    ]);
  });

  it('collapses a grandchild into its grandparent when the level between is not listed', async () => {
    const { planId, food, groceries } = await setup();
    const organic = await helpers.addCustomCategory({
      name: 'Organic',
      color: '#444444',
      parentId: groceries.id,
      raw: true,
    });

    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Deep', categoryIds: [food.id, organic.id] },
      raw: true,
    });

    expect(line.categoryIds).toEqual([food.id]);
  });

  it('collapses a child listed before its parent', async () => {
    const { planId, food, groceries } = await setup();

    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Reversed', categoryIds: [groceries.id, food.id] },
      raw: true,
    });

    expect(line.categoryIds).toEqual([food.id]);
  });

  it('refuses a category, or a descendant of it, that another line already covers', async () => {
    const { planId, food, groceries } = await setup();
    await helpers.createBudgetPlanLine({ planId, payload: { name: 'Food', categoryIds: [food.id] }, raw: true });

    expect(
      (await helpers.createBudgetPlanLine({ planId, payload: { name: 'Again', categoryIds: [food.id] } })).statusCode,
    ).toBe(ERROR_CODES.ConflictError);
    expect(
      (await helpers.createBudgetPlanLine({ planId, payload: { name: 'Child', categoryIds: [groceries.id] } }))
        .statusCode,
    ).toBe(ERROR_CODES.ConflictError);
  });

  it('refuses a parent when another line holds its child', async () => {
    const { planId, food, groceries } = await setup();
    await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Groceries', categoryIds: [groceries.id] },
      raw: true,
    });

    const response = await helpers.createBudgetPlanLine({ planId, payload: { name: 'Food', categoryIds: [food.id] } });

    expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
  });

  it('refuses a collapsed parent and child when another line holds the child', async () => {
    const { planId, food, groceries } = await setup();
    await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Groceries', categoryIds: [groceries.id] },
      raw: true,
    });

    const response = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id, groceries.id] },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
  });

  it('lets exactly one of two concurrent creates take a category', async () => {
    const { planId, food } = await setup();

    const responses = await Promise.all([
      helpers.createBudgetPlanLine({ planId, payload: { name: 'A', categoryIds: [food.id] } }),
      helpers.createBudgetPlanLine({ planId, payload: { name: 'B', categoryIds: [food.id] } }),
    ]);

    expect(responses.map((response) => response.statusCode).toSorted()).toEqual([201, ERROR_CODES.ConflictError]);
    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toHaveLength(1);
  });

  it('404s on an unknown plan', async () => {
    const { food } = await setup();

    const response = await helpers.createBudgetPlanLine({
      planId: generateRandomRecordId(),
      payload: { name: 'X', categoryIds: [food.id] },
    });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});

describe('Budget plan line update', () => {
  it('swaps categories from the current period on and leaves the earlier ones covered', async () => {
    const { planId, food, transport } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });

    const updated = await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [transport.id] },
      raw: true,
    });

    expect(updated.categoryIds).toEqual([transport.id]);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: BACKDATED, untilDate: CURRENT },
      { categoryId: transport.id, fromDate: CURRENT, untilDate: null },
    ]);
  });

  it('rewrites the whole history when effectiveFrom is the line start', async () => {
    const { planId, food, transport } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });

    await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [transport.id], effectiveFrom: BACKDATED },
      raw: true,
    });

    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: transport.id, fromDate: BACKDATED, untilDate: null },
    ]);
  });

  it('keeps an unchanged category on its original range', async () => {
    const { planId, food, transport } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });

    const updated = await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { name: 'Renamed', sortOrder: 7, categoryIds: [food.id, transport.id] },
      raw: true,
    });

    expect(updated.name).toBe('Renamed');
    expect(updated.sortOrder).toBe(7);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: BACKDATED, untilDate: null },
      { categoryId: transport.id, fromDate: CURRENT, untilDate: null },
    ]);
  });

  it('widens a kept category backwards and reopens one that was swapped out', async () => {
    const { planId, food, transport } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });
    await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [transport.id] },
      raw: true,
    });

    const updated = await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [food.id, transport.id], effectiveFrom: PREVIOUS },
      raw: true,
    });

    expect(updated.categoryIds.toSorted()).toEqual([food.id, transport.id].toSorted());
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: BACKDATED, untilDate: null },
      { categoryId: transport.id, fromDate: PREVIOUS, untilDate: null },
    ]);
  });

  it('stores only the parent when its children are listed with it', async () => {
    const { planId, food, groceries, transport } = await setup();
    const restaurants = await helpers.addCustomCategory({
      name: 'Restaurants',
      color: '#444444',
      parentId: food.id,
      raw: true,
    });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Mixed', categoryIds: [transport.id] },
      raw: true,
    });

    const updated = await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [food.id, groceries.id, restaurants.id] },
      raw: true,
    });

    expect(updated.categoryIds).toEqual([food.id]);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: CURRENT, untilDate: null },
    ]);
  });

  it('renames a line without touching its membership', async () => {
    const { planId, food } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });

    const updated = await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { name: 'Renamed', sortOrder: 2 },
      raw: true,
    });

    expect(updated).toEqual({ ...line, name: 'Renamed', sortOrder: 2 });
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: BACKDATED, untilDate: null },
    ]);
  });

  it('keeps an archived line inside its lifetime when its categories are rewritten', async () => {
    const { planId, food } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });
    const successor = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Groceries', categoryIds: [food.id] },
      raw: true,
    });

    const updated = await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [food.id], effectiveFrom: BACKDATED },
      raw: true,
    });

    expect(updated.categoryIds).toEqual([]);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: BACKDATED, untilDate: CURRENT },
    ]);

    const { lines } = await helpers.getBudgetPlan({ planId, raw: true });
    expect(lines.filter((entry) => entry.categoryIds.includes(food.id))).toEqual([successor]);
  });

  it('hands a freed category to another line from the same period', async () => {
    const { planId, food, transport } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });
    await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [transport.id] },
      raw: true,
    });

    const successor = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Groceries', categoryIds: [food.id] },
      raw: true,
    });

    expect(successor.categoryIds).toEqual([food.id]);
    expect(successor.activeFrom).toBe(CURRENT);
  });

  it('refuses an effectiveFrom outside the lifetime, in the future or without categoryIds, and an empty category list', async () => {
    const { planId, food } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });

    for (const payload of [
      { categoryIds: [food.id], effectiveFrom: BACKDATED },
      { categoryIds: [food.id], effectiveFrom: `${CURRENT.slice(0, 8)}15` },
      { categoryIds: [food.id], effectiveFrom: NEXT },
      { categoryIds: [] },
      { effectiveFrom: CURRENT },
    ]) {
      const response = await helpers.updateBudgetPlanLine({ planId, lineId: line.id, payload });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    }
  });

  it('refuses a category that another line already covers', async () => {
    const { planId, food, transport } = await setup();
    await helpers.createBudgetPlanLine({ planId, payload: { name: 'Food', categoryIds: [food.id] }, raw: true });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Transport', categoryIds: [transport.id] },
      raw: true,
    });

    const response = await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [food.id] },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
  });

  it('refuses a collapsed parent and child when another line holds the child', async () => {
    const { planId, food, groceries, transport } = await setup();
    await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Groceries', categoryIds: [groceries.id] },
      raw: true,
    });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Transport', categoryIds: [transport.id] },
      raw: true,
    });

    const response = await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [groceries.id, food.id] },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: transport.id, fromDate: CURRENT, untilDate: null },
    ]);
  });

  it('404s on an unknown line, and on a line of another plan for every line write', async () => {
    const { planId, food } = await setup();
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });

    expect(
      (await helpers.updateBudgetPlanLine({ planId, lineId: generateRandomRecordId(), payload: { name: 'X' } }))
        .statusCode,
    ).toBe(ERROR_CODES.NotFoundError);

    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const statusCodes = await helpers.asUser({
      cookies: other.cookies,
      fn: async () => {
        const { plan } = await helpers.createBudgetPlan({ raw: true });
        const [period] = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
        const target = { planId: plan.id, lineId: line.id };

        return [
          (await helpers.updateBudgetPlanLine({ ...target, payload: { name: 'Stolen' } })).statusCode,
          (
            await helpers.setBudgetAssignment({
              ...target,
              periodId: period!.id,
              payload: { scope: 'from_here', amount: 10 },
            })
          ).statusCode,
          (await helpers.archiveBudgetPlanLine(target)).statusCode,
          (await helpers.restoreBudgetPlanLine(target)).statusCode,
          (await helpers.deleteBudgetPlanLine(target)).statusCode,
        ];
      },
    });

    expect(statusCodes).toEqual([
      ERROR_CODES.NotFoundError,
      ERROR_CODES.NotFoundError,
      ERROR_CODES.NotFoundError,
      ERROR_CODES.NotFoundError,
      ERROR_CODES.NotFoundError,
    ]);
    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([line]);
  });

  it("404s on every line write against another user's plan and line", async () => {
    const { planId, food } = await setup();
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });
    const target = { planId, lineId: line.id };

    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const statusCodes = await helpers.asUser({
      cookies: other.cookies,
      fn: async () => [
        (await helpers.createBudgetPlanLine({ planId, payload: { name: 'Planted', categoryIds: [food.id] } }))
          .statusCode,
        (await helpers.updateBudgetPlanLine({ ...target, payload: { name: 'Stolen' } })).statusCode,
        (await helpers.archiveBudgetPlanLine(target)).statusCode,
        (await helpers.restoreBudgetPlanLine(target)).statusCode,
        (await helpers.deleteBudgetPlanLine(target)).statusCode,
      ],
    });

    expect(statusCodes).toEqual([
      ERROR_CODES.NotFoundError,
      ERROR_CODES.NotFoundError,
      ERROR_CODES.NotFoundError,
      ERROR_CODES.NotFoundError,
      ERROR_CODES.NotFoundError,
    ]);
    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([line]);
  });
});

describe('Budget plan line archive', () => {
  it('ends the lifetime at the current period and keeps the closed periods owned', async () => {
    const { planId, food } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });

    expect((await helpers.archiveBudgetPlanLine({ planId, lineId: line.id })).statusCode).toBe(200);

    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([
      { ...line, activeUntil: CURRENT, categoryIds: [] },
    ]);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: BACKDATED, untilDate: CURRENT },
    ]);

    const successor = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Groceries', categoryIds: [food.id] },
      raw: true,
    });
    expect(successor.categoryIds).toEqual([food.id]);

    const backdatedRival = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Rival', categoryIds: [food.id], activeFrom: BACKDATED },
    });
    expect(backdatedRival.statusCode).toBe(ERROR_CODES.ConflictError);
  });

  it('leaves a membership row that was already closed before the archive', async () => {
    const { planId, food, transport } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });
    await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [transport.id], effectiveFrom: PREVIOUS },
      raw: true,
    });

    expect((await helpers.archiveBudgetPlanLine({ planId, lineId: line.id })).statusCode).toBe(200);

    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: BACKDATED, untilDate: PREVIOUS },
      { categoryId: transport.id, fromDate: PREVIOUS, untilDate: CURRENT },
    ]);
  });

  it('refuses to archive an already archived line, one archived in its first period included', async () => {
    const { planId, food, transport } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });
    const fresh = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Transport', categoryIds: [transport.id] },
      raw: true,
    });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });
    await helpers.archiveBudgetPlanLine({ planId, lineId: fresh.id });

    for (const lineId of [line.id, fresh.id]) {
      expect((await helpers.archiveBudgetPlanLine({ planId, lineId })).statusCode).toBe(ERROR_CODES.ConflictError);
    }
  });

  it('keeps a line archived in the period it was created in, and restores it with its categories', async () => {
    const { planId, food } = await setup();
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });

    expect((await helpers.archiveBudgetPlanLine({ planId, lineId: line.id })).statusCode).toBe(200);

    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([
      { ...line, activeUntil: line.activeFrom, categoryIds: [] },
    ]);
    const periods = await helpers.listBudgetPlanPeriods({ planId, raw: true });
    const current = periods.find((period) => period.startDate === CURRENT)!;
    expect((await helpers.getBudgetPlanPeriodView({ planId, periodId: current.id, raw: true })).lines).toEqual([]);

    const restored = await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(restored).toEqual(line);
    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([line]);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: CURRENT, untilDate: null },
    ]);
  });

  it('404s on an unknown line', async () => {
    const { planId } = await setup();

    expect((await helpers.archiveBudgetPlanLine({ planId, lineId: generateRandomRecordId() })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
  });
});

/** Mid-period instant `monthsAgo`; timers stay real so requests and the DB keep working. */
const atMonthsAgo = async <T>({ monthsAgo, fn }: { monthsAgo: number; fn: () => Promise<T> }): Promise<T> => {
  jest.useFakeTimers({
    now: new Date(`${helpers.budgetPeriodStart({ monthsAgo }).slice(0, 8)}15T12:00:00.000Z`),
    doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'nextTick', 'performance'],
  });

  try {
    return await fn();
  } finally {
    jest.useRealTimers();
  }
};

const lineInPeriods = ({ planId, lineId, periods }: { planId: string; lineId: string; periods: { id: string }[] }) =>
  Promise.all(
    periods.map(async (period) => {
      const { lines } = await helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true });
      const entry = lines.find((item) => item.lineId === lineId)!;
      return { assigned: entry.assigned, categoryIds: entry.categoryIds };
    }),
  );

describe('Budget plan line restore', () => {
  const setupLine = async () => {
    const context = await setup({ monthsAgo: 3 });
    const line = await helpers.createBudgetPlanLine({
      planId: context.planId,
      payload: { name: 'Food', categoryIds: [context.food.id], activeFrom: THREE_AGO },
      raw: true,
    });
    const periods = await helpers.listBudgetPlanPeriods({ planId: context.planId, raw: true });
    await helpers.setBudgetAssignment({
      planId: context.planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 100 },
      raw: true,
    });

    return { ...context, line, periods };
  };

  it('undoes an archive made in the same period', async () => {
    const { planId, food, line, periods } = await setupLine();
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });

    const restored = await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(restored).toEqual(line);
    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([line]);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: THREE_AGO, untilDate: null },
    ]);
    expect(await lineInPeriods({ planId, lineId: line.id, periods: periods.slice(3, 5) })).toEqual([
      { assigned: 100, categoryIds: [food.id] },
      { assigned: 100, categoryIds: [food.id] },
    ]);
  });

  it('keeps a baseline rewritten in the period it was archived and restored in', async () => {
    const { planId, food, line, periods } = await setupLine();
    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[3]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 250 },
      raw: true,
    });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });

    await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(await lineInPeriods({ planId, lineId: line.id, periods: periods.slice(2, 5) })).toEqual([
      { assigned: 100, categoryIds: [food.id] },
      { assigned: 250, categoryIds: [food.id] },
      { assigned: 250, categoryIds: [food.id] },
    ]);
  });

  it('keeps the baseline of a line created, archived and restored in the same period', async () => {
    const { planId, food } = await setup();
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });
    const periods = (await helpers.listBudgetPlanPeriods({ planId, raw: true })).filter((period) =>
      [CURRENT, NEXT].includes(period.startDate),
    );
    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[0]!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 510 },
      raw: true,
    });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });

    await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(await lineInPeriods({ planId, lineId: line.id, periods })).toEqual([
      { assigned: 510, categoryIds: [food.id] },
      { assigned: 510, categoryIds: [food.id] },
    ]);
  });

  it('keeps a one-off amount set in the period it was archived and restored in', async () => {
    const { planId, food, line, periods } = await setupLine();
    await helpers.setBudgetAssignment({
      planId,
      periodId: periods[3]!.id,
      lineId: line.id,
      payload: { scope: 'this_period', amount: 175 },
      raw: true,
    });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });

    await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(await lineInPeriods({ planId, lineId: line.id, periods: periods.slice(3, 5) })).toEqual([
      { assigned: 175, categoryIds: [food.id] },
      { assigned: 100, categoryIds: [food.id] },
    ]);
  });

  it('resumes from the current period after a gap, with the archived periods at 0 and uncovered', async () => {
    const { planId, food, line, periods } = await setupLine();
    const archived = await atMonthsAgo({
      monthsAgo: 2,
      fn: () => helpers.archiveBudgetPlanLine({ planId, lineId: line.id }),
    });
    expect(archived.statusCode).toBe(200);

    const restored = await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(restored).toEqual(line);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: THREE_AGO, untilDate: BACKDATED },
      { categoryId: food.id, fromDate: CURRENT, untilDate: null },
    ]);
    expect(await lineInPeriods({ planId, lineId: line.id, periods: periods.slice(0, 5) })).toEqual([
      { assigned: 100, categoryIds: [food.id] },
      { assigned: 0, categoryIds: [] },
      { assigned: 0, categoryIds: [] },
      { assigned: 100, categoryIds: [food.id] },
      { assigned: 100, categoryIds: [food.id] },
    ]);
  });

  it('resumes after a gap with the baseline set in the archive period, without its one-off', async () => {
    const { planId, food, line, periods } = await setupLine();
    await atMonthsAgo({
      monthsAgo: 2,
      fn: async () => {
        for (const payload of [
          { scope: 'from_here', amount: 250 },
          { scope: 'this_period', amount: 300 },
        ] as const) {
          await helpers.setBudgetAssignment({ planId, periodId: periods[1]!.id, lineId: line.id, payload, raw: true });
        }
        await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });
      },
    });

    await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(await lineInPeriods({ planId, lineId: line.id, periods: periods.slice(0, 5) })).toEqual([
      { assigned: 100, categoryIds: [food.id] },
      { assigned: 0, categoryIds: [] },
      { assigned: 0, categoryIds: [] },
      { assigned: 250, categoryIds: [food.id] },
      { assigned: 250, categoryIds: [food.id] },
    ]);
  });

  it('keeps a one-off of the archive period out of the gap when the line has no baseline', async () => {
    const { planId, food } = await setup({ monthsAgo: 3 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: THREE_AGO },
      raw: true,
    });
    const periods = await helpers.listBudgetPlanPeriods({ planId, raw: true });
    await atMonthsAgo({
      monthsAgo: 2,
      fn: async () => {
        await helpers.setBudgetAssignment({
          planId,
          periodId: periods[1]!.id,
          lineId: line.id,
          payload: { scope: 'this_period', amount: 300 },
          raw: true,
        });
        await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });
      },
    });

    await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(
      (await lineInPeriods({ planId, lineId: line.id, periods: periods.slice(0, 4) })).map((entry) => entry.assigned),
    ).toEqual([0, 0, 0, 0]);
  });

  it('undoes a same-period archive of a line resumed in that period', async () => {
    const { planId, food, line, periods } = await setupLine();
    await atMonthsAgo({ monthsAgo: 2, fn: () => helpers.archiveBudgetPlanLine({ planId, lineId: line.id }) });
    await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });

    const restored = await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(restored).toEqual(line);
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: THREE_AGO, untilDate: BACKDATED },
      { categoryId: food.id, fromDate: CURRENT, untilDate: null },
    ]);
    expect(await lineInPeriods({ planId, lineId: line.id, periods: periods.slice(0, 5) })).toEqual([
      { assigned: 100, categoryIds: [food.id] },
      { assigned: 0, categoryIds: [] },
      { assigned: 0, categoryIds: [] },
      { assigned: 100, categoryIds: [food.id] },
      { assigned: 100, categoryIds: [food.id] },
    ]);
  });

  it('brings back the categories it held when archived, not ones an edit in that period removed', async () => {
    const { planId, food, transport, line } = await setupLine();
    await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { categoryIds: [transport.id] },
      raw: true,
    });
    await helpers.createBudgetPlanLine({ planId, payload: { name: 'Moved food', categoryIds: [food.id] }, raw: true });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });

    const restored = await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(restored).toEqual({ ...line, categoryIds: [transport.id] });
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: THREE_AGO, untilDate: CURRENT },
      { categoryId: transport.id, fromDate: CURRENT, untilDate: null },
    ]);
  });

  it('brings back the replacement of a category deleted while it was archived', async () => {
    const { planId, transport } = await setup({ monthsAgo: 3 });
    const travel = await helpers.addCustomCategory({ name: 'Travel', color: '#444444', raw: true });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Transport', categoryIds: [transport.id], activeFrom: THREE_AGO },
      raw: true,
    });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });
    await helpers.deleteCustomCategory({ categoryId: transport.id, replaceWithCategoryId: travel.id, raw: false });

    const restored = await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(restored).toEqual({ ...line, categoryIds: [travel.id] });
  });

  it('restarts a line archived in its first period from the current period', async () => {
    const { planId, food } = await setup({ monthsAgo: 2 });
    const line = await atMonthsAgo({
      monthsAgo: 2,
      fn: async () => {
        const created = await helpers.createBudgetPlanLine({
          planId,
          payload: { name: 'Food', categoryIds: [food.id] },
          raw: true,
        });
        await helpers.archiveBudgetPlanLine({ planId, lineId: created.id });
        return created;
      },
    });
    expect(line.activeFrom).toBe(BACKDATED);

    const restored = await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    expect(restored).toEqual({ ...line, activeFrom: CURRENT });
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: CURRENT, untilDate: null },
    ]);
    const periods = await helpers.listBudgetPlanPeriods({ planId, raw: true });
    const views = await Promise.all(
      periods.slice(0, 2).map((period) => helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true })),
    );
    expect(views.map((view) => view.lines)).toEqual([[], []]);
  });

  it('moves the baseline of a line archived in its first period to the period it is restored in', async () => {
    const { planId, food } = await setup({ monthsAgo: 2 });
    const periods = await helpers.listBudgetPlanPeriods({ planId, raw: true });
    const line = await atMonthsAgo({
      monthsAgo: 2,
      fn: async () => {
        const created = await helpers.createBudgetPlanLine({
          planId,
          payload: { name: 'Food', categoryIds: [food.id] },
          raw: true,
        });
        await helpers.setBudgetAssignment({
          planId,
          periodId: periods[0]!.id,
          lineId: created.id,
          payload: { scope: 'from_here', amount: 510 },
          raw: true,
        });
        await helpers.archiveBudgetPlanLine({ planId, lineId: created.id });
        return created;
      },
    });

    await helpers.restoreBudgetPlanLine({ planId, lineId: line.id, raw: true });

    const views = await Promise.all(
      periods.slice(0, 2).map((period) => helpers.getBudgetPlanPeriodView({ planId, periodId: period.id, raw: true })),
    );
    expect(views.map((view) => view.lines)).toEqual([[], []]);
    expect(await lineInPeriods({ planId, lineId: line.id, periods: periods.slice(2, 4) })).toEqual([
      { assigned: 510, categoryIds: [food.id] },
      { assigned: 510, categoryIds: [food.id] },
    ]);
  });

  it('refuses when another line took one of its categories after the archive, and changes nothing', async () => {
    const { planId, food, groceries, line } = await setupLine();
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });
    await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Groceries', categoryIds: [groceries.id] },
      raw: true,
    });

    const response = await helpers.restoreBudgetPlanLine({ planId, lineId: line.id });

    expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
    const { lines } = await helpers.getBudgetPlan({ planId, raw: true });
    expect(lines.find((entry) => entry.id === line.id)).toEqual({ ...line, activeUntil: CURRENT, categoryIds: [] });
    expect(await membershipRanges({ lineId: line.id })).toEqual([
      { categoryId: food.id, fromDate: THREE_AGO, untilDate: CURRENT },
    ]);
  });

  it('refuses a line that is not archived', async () => {
    const { planId, line } = await setupLine();

    expect((await helpers.restoreBudgetPlanLine({ planId, lineId: line.id })).statusCode).toBe(
      ERROR_CODES.ConflictError,
    );
  });

  it('404s on an unknown line', async () => {
    const { planId } = await setup();

    expect((await helpers.restoreBudgetPlanLine({ planId, lineId: generateRandomRecordId() })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
  });
});

describe('Budget plan line delete', () => {
  it('removes a line with history from every period, with its amounts, leaving its spending unbudgeted', async () => {
    const { planId, food } = await setup({ monthsAgo: 2 });
    const {
      accountIds: [accountId],
    } = await helpers.getBudgetPlan({ planId, raw: true });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });
    const [backdated] = await helpers.listBudgetPlanPeriods({ planId, raw: true });
    await helpers.setBudgetAssignment({
      planId,
      periodId: backdated!.id,
      lineId: line.id,
      payload: { scope: 'from_here', amount: 100 },
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: accountId as RecordId,
        categoryId: food.id,
        amount: 40,
        transactionType: TRANSACTION_TYPES.expense,
        time: `${BACKDATED}T12:00:00.000Z`,
      }),
      raw: true,
    });

    const before = await helpers.getBudgetPlanPeriodView({ planId, periodId: backdated!.id, raw: true });
    expect(before.lines.map((entry) => entry.activity)).toEqual([-40]);
    expect(before.unbudgeted).toEqual([]);

    expect((await helpers.deleteBudgetPlanLine({ planId, lineId: line.id })).statusCode).toBe(200);

    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([]);
    expect(await helpers.getBudgetPlanPeriodView({ planId, periodId: backdated!.id, raw: true })).toMatchObject({
      header: { totalAssigned: 0, totalActivity: 0, totalAvailable: 0 },
      lines: [],
      unbudgeted: [{ categoryId: food.id, activity: -40 }],
    });
    expect(await membershipRanges({ lineId: line.id })).toEqual([]);
    expect(await BudgetAssignments.count({ where: { lineId: line.id } })).toBe(0);
  });

  it('deletes an archived line and frees the periods it owned', async () => {
    const { planId, food } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });

    expect((await helpers.deleteBudgetPlanLine({ planId, lineId: line.id })).statusCode).toBe(200);

    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([]);
    expect(
      (
        await helpers.createBudgetPlanLine({
          planId,
          payload: { name: 'Rival', categoryIds: [food.id], activeFrom: BACKDATED },
        })
      ).statusCode,
    ).toBe(201);
  });

  it('deletes a line in its first period', async () => {
    const { planId, food } = await setup();
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });

    expect((await helpers.deleteBudgetPlanLine({ planId, lineId: line.id })).statusCode).toBe(200);

    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([]);
    expect(await membershipRanges({ lineId: line.id })).toEqual([]);
    expect(
      (await helpers.createBudgetPlanLine({ planId, payload: { name: 'Again', categoryIds: [food.id] } })).statusCode,
    ).toBe(201);
  });

  it('404s on an unknown line and on one already deleted', async () => {
    const { planId, food } = await setup();
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });
    await helpers.deleteBudgetPlanLine({ planId, lineId: line.id });

    for (const lineId of [generateRandomRecordId(), line.id]) {
      expect((await helpers.deleteBudgetPlanLine({ planId, lineId })).statusCode).toBe(ERROR_CODES.NotFoundError);
    }
  });
});

describe('Budget plan lines without the feature', () => {
  it('answers a write with 402', async () => {
    const { planId, food } = await setup();

    await helpers.setUserBilling({
      plan: PLANS.early_adopter,
      trialEndsAt: null,
      firstBudgetPlanAt: new Date(Date.now() - (EARLY_ADOPTER_BUDGET_TRIAL_DAYS + 1) * MS_PER_DAY),
    });

    const response = await helpers.createBudgetPlanLine({ planId, payload: { name: 'X', categoryIds: [food.id] } });
    expect(response.statusCode).toBe(ERROR_CODES.PaymentRequired);
  });
});
