import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BudgetLineNotes from '@models/budget-line-notes.model';
import * as helpers from '@tests/helpers';

const setup = async () => {
  const food = await helpers.addCustomCategory({ name: 'Food', color: '#111111', raw: true });
  const { plan } = await helpers.createBudgetPlan({
    payload: { epochDate: helpers.budgetPeriodStart({ monthsAgo: 2 }) },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
  const line = await helpers.createBudgetPlanLine({
    planId: plan.id,
    payload: { name: 'Food', categoryIds: [food.id], activeFrom: periods[0]!.startDate },
    raw: true,
  });

  return { planId: plan.id, periods, line };
};

const noteAt = async ({ planId, periodId, lineId }: { planId: string; periodId: string; lineId: string }) => {
  const view = await helpers.getBudgetPlanPeriodView({ planId, periodId, raw: true });
  return view.lines.find((entry) => entry.lineId === lineId)!.note;
};

describe('PUT /budget-plans/:planId/periods/:periodId/lines/:lineId/note', () => {
  it('sets a trimmed note on one period only and returns the view', async () => {
    const { planId, periods, line } = await setup();
    const target = { planId, periodId: periods[1]!.id, lineId: line.id };

    const view = await helpers.setBudgetLineNote({ ...target, payload: { note: '  Birthday dinner  ' }, raw: true });

    expect(view.period.id).toBe(periods[1]!.id);
    expect(view.lines.find((entry) => entry.lineId === line.id)!.note).toBe('Birthday dinner');
    expect(await noteAt(target)).toBe('Birthday dinner');
    expect(await noteAt({ ...target, periodId: periods[0]!.id })).toBeNull();
    expect(await noteAt({ ...target, periodId: periods[2]!.id })).toBeNull();
  });

  it('starts with no note', async () => {
    const { planId, periods, line } = await setup();

    expect(await noteAt({ planId, periodId: periods[0]!.id, lineId: line.id })).toBeNull();
  });

  it('replaces an existing note', async () => {
    const { planId, periods, line } = await setup();
    const target = { planId, periodId: periods[1]!.id, lineId: line.id };
    await helpers.setBudgetLineNote({ ...target, payload: { note: 'First' }, raw: true });

    const view = await helpers.setBudgetLineNote({ ...target, payload: { note: 'Second' }, raw: true });

    expect(view.lines[0]!.note).toBe('Second');
    expect(await BudgetLineNotes.count({ where: { lineId: line.id } })).toBe(1);
  });

  it.each([
    ['null', null],
    ['a blank string', '   '],
  ])('clears the note with %s', async (_, note) => {
    const { planId, periods, line } = await setup();
    const target = { planId, periodId: periods[1]!.id, lineId: line.id };
    await helpers.setBudgetLineNote({ ...target, payload: { note: 'To clear' }, raw: true });

    const view = await helpers.setBudgetLineNote({ ...target, payload: { note }, raw: true });

    expect(view.lines[0]!.note).toBeNull();
    expect(await BudgetLineNotes.count({ where: { lineId: line.id } })).toBe(0);
  });

  it('keeps the note when the period override is cleared', async () => {
    const { planId, periods, line } = await setup();
    const target = { planId, periodId: periods[1]!.id, lineId: line.id };
    await helpers.setBudgetAssignment({ ...target, payload: { scope: 'this_period', amount: 100 }, raw: true });
    await helpers.setBudgetLineNote({ ...target, payload: { note: 'Gift' }, raw: true });

    const view = await helpers.setBudgetAssignment({
      ...target,
      payload: { scope: 'this_period', amount: null },
      raw: true,
    });

    expect(view.lines[0]).toMatchObject({ assignedSource: 'none', note: 'Gift' });
  });

  it('removes the notes of a permanently deleted line', async () => {
    const { planId, periods, line } = await setup();
    for (const period of periods.slice(0, 2)) {
      await helpers.setBudgetLineNote({
        planId,
        periodId: period.id,
        lineId: line.id,
        payload: { note: 'x' },
        raw: true,
      });
    }
    expect(await BudgetLineNotes.count({ where: { lineId: line.id } })).toBe(2);

    expect((await helpers.deleteBudgetPlanLine({ planId, lineId: line.id })).statusCode).toBe(200);

    expect(await BudgetLineNotes.count({ where: { lineId: line.id } })).toBe(0);
  });

  it('accepts 1000 characters and rejects 1001 or an invalid body', async () => {
    const { planId, periods, line } = await setup();
    const target = { planId, periodId: periods[1]!.id, lineId: line.id };

    const ok = await helpers.setBudgetLineNote({ ...target, payload: { note: 'a'.repeat(1000) }, raw: true });
    expect(ok.lines[0]!.note).toHaveLength(1000);

    for (const payload of [{ note: 'a'.repeat(1001) }, {}, { note: 5 }, { note: 'x', extra: 1 }]) {
      const res = await helpers.setBudgetLineNote({ ...target, payload });
      expect({ payload, statusCode: res.statusCode }).toEqual({ payload, statusCode: ERROR_CODES.ValidationError });
    }
    expect(await noteAt(target)).toHaveLength(1000);
  });

  it('answers 404 for an unknown line or period', async () => {
    const { planId, periods, line } = await setup();

    const unknownLine = await helpers.setBudgetLineNote({
      planId,
      periodId: periods[1]!.id,
      lineId: generateRandomRecordId(),
      payload: { note: 'x' },
    });
    expect(unknownLine.statusCode).toBe(ERROR_CODES.NotFoundError);

    const unknownPeriod = await helpers.setBudgetLineNote({
      planId,
      periodId: generateRandomRecordId(),
      lineId: line.id,
      payload: { note: 'x' },
    });
    expect(unknownPeriod.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('answers 409 for a period outside the line lifetime', async () => {
    const { planId, periods } = await setup();
    const rent = await helpers.addCustomCategory({ name: 'Rent', color: '#222222', raw: true });
    const late = await helpers.createBudgetPlanLine({
      planId,
      payload: { name: 'Rent', categoryIds: [rent.id], activeFrom: periods[1]!.startDate },
      raw: true,
    });

    const res = await helpers.setBudgetLineNote({
      planId,
      periodId: periods[0]!.id,
      lineId: late.id,
      payload: { note: 'x' },
    });

    expect(res.statusCode).toBe(ERROR_CODES.ConflictError);
  });

  it("answers 404 when another user writes a note on the owner's line", async () => {
    const { planId, periods, line } = await setup();
    const target = { planId, periodId: periods[1]!.id, lineId: line.id };
    const other = await helpers.provisionSecondUserWithBaseCurrency();

    const res = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.setBudgetLineNote({ ...target, payload: { note: 'Intruder' } }),
    });

    expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(await noteAt(target)).toBeNull();
  });
});
