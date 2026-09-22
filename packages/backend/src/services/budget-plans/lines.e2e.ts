import { PLANS } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { toUtcDateString } from '@common/utils/date';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BudgetLineCategories from '@models/budget-line-categories.model';
import * as helpers from '@tests/helpers';

const CURRENT = helpers.budgetPeriodStart();
const PREVIOUS = helpers.budgetPeriodStart({ monthsAgo: 1 });
const BACKDATED = helpers.budgetPeriodStart({ monthsAgo: 2 });

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
  it('starts the line in the current period and returns the categories it covers there', async () => {
    const { planId, food } = await setup();

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

    for (const activeFrom of [
      helpers.budgetPeriodStart({ monthsAgo: 3 }),
      helpers.budgetPeriodStart({ monthsAgo: -1 }),
      `${CURRENT.slice(0, 8)}15`,
    ]) {
      const response = await helpers.createBudgetPlanLine({
        planId,
        payload: { name: 'Other', categoryIds: [transport.id], activeFrom },
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    }
  });

  it('refuses a category the user does not own, and an empty list', async () => {
    const { planId } = await setup();

    expect(
      (await helpers.createBudgetPlanLine({ planId, payload: { name: 'X', categoryIds: [generateRandomRecordId()] } }))
        .statusCode,
    ).toBe(ERROR_CODES.ValidationError);
    expect((await helpers.createBudgetPlanLine({ planId, payload: { name: 'X', categoryIds: [] } })).statusCode).toBe(
      ERROR_CODES.ValidationError,
    );
  });

  it('refuses a parent and its child inside one line', async () => {
    const { planId, food, groceries } = await setup();

    const response = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Both', categoryIds: [food.id, groceries.id] },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
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

  it('refuses an effectiveFrom outside the lifetime or without categoryIds, and an empty category list', async () => {
    const { planId, food } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });

    for (const payload of [
      { categoryIds: [food.id], effectiveFrom: BACKDATED },
      { categoryIds: [food.id], effectiveFrom: `${CURRENT.slice(0, 8)}15` },
      { categoryIds: [] },
      { effectiveFrom: CURRENT },
    ]) {
      const response = await helpers.updateBudgetPlanLine({ planId, lineId: line.id, payload });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    }
  });

  it('404s on an unknown line and on a line of another plan', async () => {
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
    expect(
      (
        await helpers.updateBudgetPlanLine({
          planId: generateRandomRecordId(),
          lineId: line.id,
          payload: { name: 'X' },
        })
      ).statusCode,
    ).toBe(ERROR_CODES.NotFoundError);
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

  it('refuses to archive an already archived line', async () => {
    const { planId, food } = await setup({ monthsAgo: 2 });
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id], activeFrom: BACKDATED },
      raw: true,
    });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });

    expect((await helpers.archiveBudgetPlanLine({ planId, lineId: line.id })).statusCode).toBe(
      ERROR_CODES.ConflictError,
    );
  });

  it('hard-deletes a line created and archived inside one period', async () => {
    const { planId, food } = await setup();
    const line = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });

    expect((await helpers.archiveBudgetPlanLine({ planId, lineId: line.id })).statusCode).toBe(200);

    expect((await helpers.getBudgetPlan({ planId, raw: true })).lines).toEqual([]);
    expect(await membershipRanges({ lineId: line.id })).toEqual([]);
    expect(
      (await helpers.createBudgetPlanLine({ planId, payload: { name: 'Again', categoryIds: [food.id] } })).statusCode,
    ).toBe(201);
  });

  it('404s on an unknown line', async () => {
    const { planId } = await setup();

    expect((await helpers.archiveBudgetPlanLine({ planId, lineId: generateRandomRecordId() })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
  });
});

describe('Budget plan lines without the feature', () => {
  it('answers a write with 402', async () => {
    const { planId, food } = await setup();

    await helpers.setUserBilling({ plan: PLANS.early_adopter, trialEndsAt: null });

    const response = await helpers.createBudgetPlanLine({ planId, payload: { name: 'X', categoryIds: [food.id] } });
    expect(response.statusCode).toBe(ERROR_CODES.PaymentRequired);
  });
});
