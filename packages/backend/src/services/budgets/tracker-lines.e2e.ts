import { BUDGET_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const addCategory = ({ name, parentId }: { name: string; parentId?: string }) =>
  helpers.addCustomCategory({ name, color: '#FF0000', parentId, raw: true });

describe('Tracker lines', () => {
  it('creates, reorders, updates and deletes lines', async () => {
    const [food, fun, travel] = await Promise.all([
      addCategory({ name: 'Food' }),
      addCategory({ name: 'Fun' }),
      addCategory({ name: 'Travel' }),
    ]);
    const budget = await helpers.createCustomBudget({ name: 'Tracker', raw: true });

    const foodLine = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Food', limitAmount: 150.5, categoryIds: [food.id] },
      raw: true,
    });
    expect(foodLine).toMatchObject({ budgetId: budget.id, name: 'Food', limitAmount: 150.5, position: 0 });
    expect(foodLine.categories.map((c) => c.id)).toEqual([food.id]);

    const funLine = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Fun', categoryIds: [fun.id] },
      raw: true,
    });
    expect(funLine.position).toBe(1);
    expect(funLine.limitAmount).toBe(null);

    await helpers.updateTrackerLine({ budgetId: budget.id, lineId: foodLine.id, payload: { position: 5 }, raw: true });

    const reordered = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
    expect(reordered!.lines!.map((line) => line.name)).toEqual(['Fun', 'Food']);
    expect(reordered!.lines![1]!.categories.map((c) => c.id)).toEqual([food.id]);

    const updated = await helpers.updateTrackerLine({
      budgetId: budget.id,
      lineId: foodLine.id,
      payload: { name: 'Groceries', limitAmount: null, categoryIds: [fun.id, travel.id] },
      raw: true,
    });
    expect(updated).toMatchObject({ name: 'Groceries', limitAmount: null, position: 5 });
    expect(updated.categories.map((c) => c.id).toSorted()).toEqual([fun.id, travel.id].toSorted());

    await helpers.deleteTrackerLine({ budgetId: budget.id, lineId: funLine.id, raw: true });

    const afterDelete = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
    expect(afterDelete!.lines!.map((line) => line.id)).toEqual([foodLine.id]);
  });

  it('expands a parent category to its children', async () => {
    const parent = await addCategory({ name: 'Entertainment' });
    const [movies, games] = await Promise.all([
      addCategory({ name: 'Movies', parentId: parent.id }),
      addCategory({ name: 'Games', parentId: parent.id }),
    ]);
    const budget = await helpers.createCustomBudget({ name: 'Tracker', raw: true });

    const line = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Fun', categoryIds: [parent.id] },
      raw: true,
    });

    expect(line.categories.map((c) => c.id).toSorted()).toEqual([parent.id, movies.id, games.id].toSorted());
  });

  it('returns an empty lines list for a tracker without lines', async () => {
    const budget = await helpers.createCustomBudget({ name: 'Tracker', raw: true });

    const byId = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
    const list = await helpers.getCustomBudgets({ raw: true });

    expect(byId!.lines).toEqual([]);
    expect(list.find((b) => b.id === budget.id)!.lines).toEqual([]);
  });

  it('rejects an invalid payload with 422', async () => {
    const category = await addCategory({ name: 'Food' });
    const budget = await helpers.createCustomBudget({ name: 'Tracker', raw: true });

    const invalidPayloads = [
      { name: '', categoryIds: [category.id] },
      { name: '   ', categoryIds: [category.id] },
      { name: 'Food', categoryIds: [] },
      { name: 'Food', categoryIds: [category.id], limitAmount: 0 },
      { name: 'Food', categoryIds: [NONEXISTENT_ID] },
    ];

    for (const payload of invalidPayloads) {
      const response = await helpers.createTrackerLine({ budgetId: budget.id, payload, raw: false });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const fetched = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
      expect(fetched!.lines).toEqual([]);
    }
  });

  it('leaves the line untouched when an update is rejected', async () => {
    const category = await addCategory({ name: 'Food' });
    const budget = await helpers.createCustomBudget({ name: 'Tracker', raw: true });
    const line = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Food', categoryIds: [category.id] },
      raw: true,
    });

    const response = await helpers.updateTrackerLine({
      budgetId: budget.id,
      lineId: line.id,
      payload: { name: 'Renamed', categoryIds: [NONEXISTENT_ID] },
      raw: false,
    });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

    const fetched = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
    expect(fetched!.lines).toHaveLength(1);
    expect(fetched!.lines![0]).toMatchObject({ id: line.id, name: 'Food' });
    expect(fetched!.lines![0]!.categories.map((c) => c.id)).toEqual([category.id]);
  });

  it('returns 404 to a user the tracker is not shared with', async () => {
    const category = await addCategory({ name: 'Food' });
    const budget = await helpers.createCustomBudget({ name: 'Private', raw: true });
    const line = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Food', categoryIds: [category.id] },
      raw: true,
    });
    const stranger = await helpers.provisionSecondUserWithBaseCurrency();

    const responses = await helpers.asUser({
      cookies: stranger.cookies,
      fn: () =>
        Promise.all([
          helpers.createTrackerLine({
            budgetId: budget.id,
            payload: { name: 'X', categoryIds: [category.id] },
            raw: false,
          }),
          helpers.updateTrackerLine({ budgetId: budget.id, lineId: line.id, payload: { name: 'X' }, raw: false }),
          helpers.deleteTrackerLine({ budgetId: budget.id, lineId: line.id, raw: false }),
        ]),
    });

    expect(responses.map((r) => r.statusCode)).toEqual([
      ERROR_CODES.NotFoundError,
      ERROR_CODES.NotFoundError,
      ERROR_CODES.NotFoundError,
    ]);
    const fetched = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
    expect(fetched!.lines!.map((l) => ({ id: l.id, name: l.name }))).toEqual([{ id: line.id, name: 'Food' }]);
  });

  it('returns 404 for a line that belongs to another tracker', async () => {
    const category = await addCategory({ name: 'Food' });
    const [budgetA, budgetB] = await Promise.all([
      helpers.createCustomBudget({ name: 'A', raw: true }),
      helpers.createCustomBudget({ name: 'B', raw: true }),
    ]);
    const line = await helpers.createTrackerLine({
      budgetId: budgetA.id,
      payload: { name: 'Food', categoryIds: [category.id] },
      raw: true,
    });

    const updateRes = await helpers.updateTrackerLine({
      budgetId: budgetB.id,
      lineId: line.id,
      payload: { name: 'Hijacked' },
      raw: false,
    });
    const deleteRes = await helpers.deleteTrackerLine({ budgetId: budgetB.id, lineId: line.id, raw: false });
    const unknownRes = await helpers.deleteTrackerLine({ budgetId: budgetA.id, lineId: NONEXISTENT_ID, raw: false });

    expect(updateRes.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(deleteRes.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(unknownRes.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('hides line mutations from read and write recipients and allows them for manage', async () => {
    const category = await addCategory({ name: 'Food' });
    const budget = await helpers.createCustomBudget({ name: 'Shared', raw: true });
    const line = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Food', categoryIds: [category.id] },
      raw: true,
    });

    for (const permission of [SHARE_PERMISSIONS.read, SHARE_PERMISSIONS.write]) {
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.shareBudgetWith({ budgetId: budget.id, recipient, permission });

      const responses = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          Promise.all([
            helpers.createTrackerLine({
              budgetId: budget.id,
              payload: { name: 'X', categoryIds: [category.id] },
              raw: false,
            }),
            helpers.updateTrackerLine({ budgetId: budget.id, lineId: line.id, payload: { name: 'X' }, raw: false }),
            helpers.deleteTrackerLine({ budgetId: budget.id, lineId: line.id, raw: false }),
          ]),
      });

      expect(responses.map((r) => r.statusCode)).toEqual([
        ERROR_CODES.NotFoundError,
        ERROR_CODES.NotFoundError,
        ERROR_CODES.NotFoundError,
      ]);
    }

    const manager = await helpers.provisionSecondUserWithBaseCurrency();
    await helpers.shareBudgetWith({ budgetId: budget.id, recipient: manager, permission: SHARE_PERMISSIONS.manage });
    const managerCategory = await helpers.asUser({
      cookies: manager.cookies,
      fn: () => addCategory({ name: 'Manager own' }),
    });

    const created = await helpers.asUser({
      cookies: manager.cookies,
      fn: () =>
        helpers.createTrackerLine({
          budgetId: budget.id,
          payload: { name: 'By manager', categoryIds: [category.id] },
          raw: true,
        }),
    });
    expect(created.categories.map((c) => c.id)).toEqual([category.id]);

    const foreignCategoryRes = await helpers.asUser({
      cookies: manager.cookies,
      fn: () =>
        helpers.createTrackerLine({
          budgetId: budget.id,
          payload: { name: 'Foreign', categoryIds: [managerCategory.id] },
          raw: false,
        }),
    });
    expect(foreignCategoryRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const foreignUpdateRes = await helpers.asUser({
      cookies: manager.cookies,
      fn: () =>
        helpers.updateTrackerLine({
          budgetId: budget.id,
          lineId: line.id,
          payload: { name: 'Foreign', categoryIds: [managerCategory.id] },
          raw: false,
        }),
    });
    expect(foreignUpdateRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const afterForeignUpdate = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
    const untouched = afterForeignUpdate!.lines!.find((l) => l.id === line.id)!;
    expect(untouched.name).toBe('Food');
    expect(untouched.categories.map((c) => c.id)).toEqual([category.id]);

    const updatedByManager = await helpers.asUser({
      cookies: manager.cookies,
      fn: () =>
        helpers.updateTrackerLine({
          budgetId: budget.id,
          lineId: line.id,
          payload: { name: 'Renamed by manager', limitAmount: 50 },
          raw: true,
        }),
    });
    expect(updatedByManager).toMatchObject({ id: line.id, name: 'Renamed by manager', limitAmount: 50 });

    await helpers.asUser({
      cookies: manager.cookies,
      fn: () => helpers.deleteTrackerLine({ budgetId: budget.id, lineId: created.id, raw: true }),
    });

    const afterManager = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
    expect(afterManager!.lines!.map((l) => ({ id: l.id, name: l.name }))).toEqual([
      { id: line.id, name: 'Renamed by manager' },
    ]);
  });

  it("restricts a category tracker's lines to the tracker's categories", async () => {
    const [food, fun, travel] = await Promise.all([
      addCategory({ name: 'Food' }),
      addCategory({ name: 'Fun' }),
      addCategory({ name: 'Travel' }),
    ]);
    const budget = await helpers.createCustomBudget({
      name: 'Category tracker',
      type: BUDGET_TYPES.category,
      categoryIds: [food.id, fun.id],
      raw: true,
    });

    const outsideRes = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Travel', categoryIds: [travel.id] },
      raw: false,
    });
    expect(outsideRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const line = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Food', categoryIds: [food.id] },
      raw: true,
    });
    expect(line.categories.map((c) => c.id)).toEqual([food.id]);

    const outsideUpdateRes = await helpers.updateTrackerLine({
      budgetId: budget.id,
      lineId: line.id,
      payload: { categoryIds: [food.id, travel.id] },
      raw: false,
    });
    expect(outsideUpdateRes.statusCode).toBe(ERROR_CODES.ValidationError);

    const fetched = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
    expect(fetched!.lines!.map((l) => l.id)).toEqual([line.id]);
    expect(fetched!.lines![0]!.categories.map((c) => c.id)).toEqual([food.id]);
  });

  it("keeps a picked parent's untracked new child out of a category tracker's line", async () => {
    const parent = await addCategory({ name: 'Entertainment' });
    const movies = await addCategory({ name: 'Movies', parentId: parent.id });
    const budget = await helpers.createCustomBudget({
      name: 'Category tracker',
      type: BUDGET_TYPES.category,
      categoryIds: [parent.id],
      raw: true,
    });
    const games = await addCategory({ name: 'Games', parentId: parent.id });

    const line = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Fun', categoryIds: [parent.id] },
      raw: true,
    });

    const lineCategoryIds = line.categories.map((c) => c.id).toSorted();
    expect(lineCategoryIds).toEqual([parent.id, movies.id].toSorted());
    expect(lineCategoryIds).not.toContain(games.id);
  });

  it('expands a picked parent to only the children a category tracker tracks', async () => {
    const parent = await addCategory({ name: 'Entertainment' });
    const [movies] = await Promise.all([
      addCategory({ name: 'Movies', parentId: parent.id }),
      addCategory({ name: 'Games', parentId: parent.id }),
    ]);
    const budget = await helpers.createCustomBudget({
      name: 'Category tracker',
      type: BUDGET_TYPES.category,
      categoryIds: [movies!.id],
      raw: true,
    });

    const res = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Fun', categoryIds: [parent.id] },
      raw: false,
    });

    expect(res.statusCode).toBe(200);
    expect(helpers.extractResponse(res).categories.map((c) => c.id)).toEqual([movies!.id]);
  });

  it('drops removed tracker categories from its lines and deletes lines left empty', async () => {
    const [food, fun, travel] = await Promise.all([
      addCategory({ name: 'Food' }),
      addCategory({ name: 'Fun' }),
      addCategory({ name: 'Travel' }),
    ]);
    const budget = await helpers.createCustomBudget({
      name: 'Category tracker',
      type: BUDGET_TYPES.category,
      categoryIds: [food.id, fun.id, travel.id],
      raw: true,
    });
    const mixedLine = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Food & fun', categoryIds: [food.id, fun.id] },
      raw: true,
    });
    const funLine = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Fun', categoryIds: [fun.id] },
      raw: true,
    });

    const edited = await helpers.editCustomBudget({
      id: budget.id,
      params: { categoryIds: [food.id, travel.id] },
      raw: true,
    });
    expect(edited.lines!.map((l) => l.id)).toEqual([mixedLine.id]);

    const fetched = await helpers.getCustomBudgetById({ id: budget.id, raw: true });
    expect(fetched!.lines!.map((l) => l.id)).toEqual([mixedLine.id]);
    expect(fetched!.lines![0]!.categories.map((c) => c.id)).toEqual([food.id]);
    expect(fetched!.lines!.map((l) => l.id)).not.toContain(funLine.id);
  });

  it('deletes lines together with their tracker', async () => {
    const category = await addCategory({ name: 'Food' });
    const budget = await helpers.createCustomBudget({ name: 'Tracker', raw: true });
    const line = await helpers.createTrackerLine({
      budgetId: budget.id,
      payload: { name: 'Food', categoryIds: [category.id] },
      raw: true,
    });

    await helpers.deleteCustomBudget({ id: budget.id, raw: true });

    const byIdRes = await helpers.getCustomBudgetById({ id: budget.id, raw: false });
    expect(byIdRes.statusCode).toBe(ERROR_CODES.NotFoundError);

    const listed = await helpers.getCustomBudgets({ status: 'active,archived', raw: true });
    expect(listed.map((b) => b.id)).not.toContain(budget.id);
    expect(listed.flatMap((b) => b.lines ?? []).map((l) => l.id)).not.toContain(line.id);
  });
});
