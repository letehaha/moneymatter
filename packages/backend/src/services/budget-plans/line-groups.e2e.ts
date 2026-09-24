import type { RecordId } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const setup = async () => {
  const { plan } = await helpers.createBudgetPlan({ raw: true });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
  const current = periods.find((period) => period.isCurrent)!;

  const addLine = async ({ name, groupId }: { name: string; groupId?: RecordId | null }) => {
    const category = await helpers.addCustomCategory({ name, color: '#111111', raw: true });
    return helpers.createBudgetPlanLine({
      planId: plan.id,
      payload: { name, categoryIds: [category.id], groupId },
      raw: true,
    });
  };
  const addGroup = ({ name }: { name: string }) => helpers.createBudgetLineGroup({ planId: plan.id, name, raw: true });
  const view = () => helpers.getBudgetPlanPeriodView({ planId: plan.id, periodId: current.id, raw: true });
  const planLines = async () => (await helpers.getBudgetPlan({ planId: plan.id, raw: true })).lines;

  return { planId: plan.id, addLine, addGroup, view, planLines };
};

describe('Budget line groups: CRUD', () => {
  it('returns no groups and ungrouped lines by default', async () => {
    const { addLine, view } = await setup();
    await addLine({ name: 'Food' });

    const result = await view();

    expect(result.groups).toEqual([]);
    expect(result.lines[0]!.groupId).toBeNull();
  });

  it('creates groups at the end, renames and deletes them', async () => {
    const { planId, addGroup, view } = await setup();

    const bills = await addGroup({ name: 'Bills' });
    const fun = await addGroup({ name: 'Fun' });
    expect(bills).toEqual({ id: expect.any(String), name: 'Bills', sortOrder: 0 });
    expect(fun.sortOrder).toBe(1);

    const renamed = await helpers.updateBudgetLineGroup({
      planId,
      groupId: bills.id,
      name: 'Monthly bills',
      raw: true,
    });
    expect(renamed.name).toBe('Monthly bills');

    expect((await view()).groups).toEqual([
      { id: bills.id, name: 'Monthly bills', sortOrder: 0 },
      { id: fun.id, name: 'Fun', sortOrder: 1 },
    ]);

    expect((await helpers.deleteBudgetLineGroup({ planId, groupId: fun.id })).statusCode).toBe(200);
    expect((await view()).groups.map((group) => group.id)).toEqual([bills.id]);
  });

  it('rejects an empty name and an unknown group', async () => {
    const { planId, addGroup } = await setup();
    await addGroup({ name: 'Bills' });

    expect((await helpers.createBudgetLineGroup({ planId, name: '  ' })).statusCode).toBe(ERROR_CODES.ValidationError);
    expect(
      (await helpers.updateBudgetLineGroup({ planId, groupId: generateRandomRecordId(), name: 'X' })).statusCode,
    ).toBe(ERROR_CODES.NotFoundError);
    expect((await helpers.deleteBudgetLineGroup({ planId, groupId: generateRandomRecordId() })).statusCode).toBe(
      ERROR_CODES.NotFoundError,
    );
  });

  it('refuses to delete a group that holds a live line', async () => {
    const { planId, addGroup, addLine } = await setup();
    const group = await addGroup({ name: 'Bills' });
    await addLine({ name: 'Rent', groupId: group.id });

    expect((await helpers.deleteBudgetLineGroup({ planId, groupId: group.id })).statusCode).toBe(
      ERROR_CODES.ConflictError,
    );
  });

  it('deletes a group holding only archived lines, which become ungrouped', async () => {
    const { planId, addGroup, addLine, planLines } = await setup();
    const group = await addGroup({ name: 'Bills' });
    const line = await addLine({ name: 'Rent', groupId: group.id });
    await helpers.archiveBudgetPlanLine({ planId, lineId: line.id });

    expect((await helpers.deleteBudgetLineGroup({ planId, groupId: group.id })).statusCode).toBe(200);

    const archived = (await planLines()).find((entry) => entry.id === line.id)!;
    expect(archived.groupId).toBeNull();
  });
});

describe('Budget line groups: lines', () => {
  it('puts a created line last in its group and exposes groupId in the period view', async () => {
    const { addGroup, addLine, view } = await setup();
    const group = await addGroup({ name: 'Bills' });

    const rent = await addLine({ name: 'Rent', groupId: group.id });
    const power = await addLine({ name: 'Power', groupId: group.id });
    const food = await addLine({ name: 'Food' });

    expect([rent.groupId, rent.sortOrder]).toEqual([group.id, 0]);
    expect([power.groupId, power.sortOrder]).toEqual([group.id, 1]);
    expect(food.groupId).toBeNull();

    const lines = (await view()).lines;
    expect(lines.find((line) => line.lineId === power.id)!.groupId).toBe(group.id);
    expect(lines.find((line) => line.lineId === food.id)!.groupId).toBeNull();
  });

  it("refuses a group that isn't the plan's on create and update", async () => {
    const { planId, addLine } = await setup();
    const category = await helpers.addCustomCategory({ name: 'Rent', color: '#111111', raw: true });

    const created = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Rent', categoryIds: [category.id], groupId: generateRandomRecordId() },
    });
    expect(created.statusCode).toBe(ERROR_CODES.ValidationError);

    const line = await addLine({ name: 'Food' });
    const updated = await helpers.updateBudgetPlanLine({
      planId,
      lineId: line.id,
      payload: { groupId: generateRandomRecordId() },
    });
    expect(updated.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('moves a line to the end of another group, and ungroups it', async () => {
    const { planId, addGroup, addLine } = await setup();
    const [bills, fun] = [await addGroup({ name: 'Bills' }), await addGroup({ name: 'Fun' })];
    const rent = await addLine({ name: 'Rent', groupId: bills.id });
    await addLine({ name: 'Games', groupId: fun.id });

    const moved = await helpers.updateBudgetPlanLine({
      planId,
      lineId: rent.id,
      payload: { groupId: fun.id },
      raw: true,
    });
    expect([moved.groupId, moved.sortOrder]).toEqual([fun.id, 1]);

    const ungrouped = await helpers.updateBudgetPlanLine({
      planId,
      lineId: rent.id,
      payload: { groupId: null },
      raw: true,
    });
    expect(ungrouped.groupId).toBeNull();
  });

  it('puts each created ungrouped line last among the ungrouped lines', async () => {
    const { addLine } = await setup();

    const food = await addLine({ name: 'Food' });
    const fuel = await addLine({ name: 'Fuel' });
    const fun = await addLine({ name: 'Fun' });

    expect([food.sortOrder, fuel.sortOrder, fun.sortOrder]).toEqual([0, 1, 2]);
  });

  it('puts a line moved to ungrouped after the existing ungrouped lines', async () => {
    const { planId, addGroup, addLine } = await setup();
    const bills = await addGroup({ name: 'Bills' });
    await addLine({ name: 'Food' });
    await addLine({ name: 'Fuel' });
    const rent = await addLine({ name: 'Rent', groupId: bills.id });

    const moved = await helpers.updateBudgetPlanLine({
      planId,
      lineId: rent.id,
      payload: { groupId: null },
      raw: true,
    });

    expect([moved.groupId, moved.sortOrder]).toEqual([null, 2]);
  });
});

describe('Budget line groups: layout', () => {
  it('reorders groups and moves lines between groups and ungrouped', async () => {
    const { planId, addGroup, addLine, view } = await setup();
    const bills = await addGroup({ name: 'Bills' });
    const fun = await addGroup({ name: 'Fun' });
    const rent = await addLine({ name: 'Rent', groupId: bills.id });
    const power = await addLine({ name: 'Power', groupId: bills.id });
    const games = await addLine({ name: 'Games', groupId: fun.id });
    const food = await addLine({ name: 'Food' });

    const response = await helpers.setBudgetPlanLayout({
      planId,
      payload: {
        groups: [
          { id: fun.id, lineIds: [power.id, games.id] },
          { id: bills.id, lineIds: [food.id] },
        ],
        ungroupedLineIds: [rent.id],
      },
    });
    expect(response.statusCode).toBe(200);

    const result = await view();
    expect(result.groups.map((group) => [group.id, group.sortOrder])).toEqual([
      [fun.id, 0],
      [bills.id, 1],
    ]);
    const placement = (lineId: string) => {
      const line = result.lines.find((entry) => entry.lineId === lineId)!;
      return [line.groupId, line.sortOrder];
    };
    expect(placement(power.id)).toEqual([fun.id, 0]);
    expect(placement(games.id)).toEqual([fun.id, 1]);
    expect(placement(food.id)).toEqual([bills.id, 0]);
    expect(placement(rent.id)).toEqual([null, 0]);
  });

  it('leaves unlisted lines, such as archived ones, as they were', async () => {
    const { planId, addGroup, addLine, planLines } = await setup();
    const bills = await addGroup({ name: 'Bills' });
    const old = await addLine({ name: 'Old', groupId: bills.id });
    const rent = await addLine({ name: 'Rent', groupId: bills.id });
    await helpers.archiveBudgetPlanLine({ planId, lineId: old.id });

    await helpers.setBudgetPlanLayout({
      planId,
      payload: { groups: [{ id: bills.id, lineIds: [] }], ungroupedLineIds: [rent.id] },
      raw: true,
    });

    const lines = await planLines();
    expect(lines.find((line) => line.id === old.id)).toMatchObject({ groupId: bills.id, sortOrder: 0 });
    expect(lines.find((line) => line.id === rent.id)).toMatchObject({ groupId: null, sortOrder: 0 });
  });

  it('accepts an empty layout for a plan without groups or lines', async () => {
    const { planId } = await setup();

    const response = await helpers.setBudgetPlanLayout({ planId, payload: { groups: [], ungroupedLineIds: [] } });
    expect(response.statusCode).toBe(200);
  });

  it('rejects foreign, duplicate and missing ids', async () => {
    const { planId, addGroup, addLine } = await setup();
    const bills = await addGroup({ name: 'Bills' });
    const fun = await addGroup({ name: 'Fun' });
    const rent = await addLine({ name: 'Rent', groupId: bills.id });

    const payloads = [
      { groups: [{ id: bills.id, lineIds: [] }], ungroupedLineIds: [rent.id] },
      {
        groups: [
          { id: bills.id, lineIds: [] },
          { id: fun.id, lineIds: [] },
          { id: bills.id, lineIds: [] },
        ],
        ungroupedLineIds: [],
      },
      {
        groups: [
          { id: bills.id, lineIds: [] },
          { id: generateRandomRecordId(), lineIds: [] },
        ],
        ungroupedLineIds: [],
      },
      {
        groups: [
          { id: bills.id, lineIds: [rent.id] },
          { id: fun.id, lineIds: [] },
        ],
        ungroupedLineIds: [rent.id],
      },
      {
        groups: [
          { id: bills.id, lineIds: [generateRandomRecordId()] },
          { id: fun.id, lineIds: [] },
        ],
        ungroupedLineIds: [],
      },
    ];

    for (const payload of payloads) {
      expect((await helpers.setBudgetPlanLayout({ planId, payload })).statusCode).toBe(ERROR_CODES.ValidationError);
    }
  });

  it("hides another user's plan behind a 404", async () => {
    const { planId, addGroup } = await setup();
    const group = await addGroup({ name: 'Bills' });

    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const statusCodes = await helpers.asUser({
      cookies: other.cookies,
      fn: async () => [
        (await helpers.createBudgetLineGroup({ planId, name: 'Stolen' })).statusCode,
        (await helpers.updateBudgetLineGroup({ planId, groupId: group.id, name: 'Stolen' })).statusCode,
        (await helpers.deleteBudgetLineGroup({ planId, groupId: group.id })).statusCode,
        (
          await helpers.setBudgetPlanLayout({
            planId,
            payload: { groups: [{ id: group.id, lineIds: [] }], ungroupedLineIds: [] },
          })
        ).statusCode,
      ],
    });

    expect(statusCodes).toEqual(Array(4).fill(ERROR_CODES.NotFoundError));
  });
});
