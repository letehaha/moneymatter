import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const setup = async () => {
  const { plan } = await helpers.createBudgetPlan({
    payload: { epochDate: helpers.budgetPeriodStart({ monthsAgo: 2 }) },
    raw: true,
  });
  const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });

  return { planId: plan.id, periods };
};

const noteAt = async ({ planId, periodId }: { planId: string; periodId: string }) =>
  (await helpers.getBudgetPlanPeriodView({ planId, periodId, raw: true })).period.note;

describe('PUT /budget-plans/:planId/periods/:periodId/note', () => {
  it('sets a trimmed note on one period only and returns the view', async () => {
    const { planId, periods } = await setup();
    const target = { planId, periodId: periods[1]!.id };

    const view = await helpers.setBudgetPeriodNote({ ...target, payload: { note: '  Holiday month  ' }, raw: true });

    expect(view.period).toMatchObject({ id: periods[1]!.id, note: 'Holiday month' });
    expect(await noteAt(target)).toBe('Holiday month');
    expect(await noteAt({ planId, periodId: periods[0]!.id })).toBeNull();
    expect(await noteAt({ planId, periodId: periods[2]!.id })).toBeNull();

    const listed = await helpers.listBudgetPlanPeriods({ planId, raw: true });
    expect(listed.find((period) => period.id === periods[1]!.id)!.note).toBe('Holiday month');
  });

  it('starts with no note', async () => {
    const { periods } = await setup();

    expect(periods.every((period) => period.note === null)).toBe(true);
  });

  it('replaces an existing note', async () => {
    const { planId, periods } = await setup();
    const target = { planId, periodId: periods[1]!.id };
    await helpers.setBudgetPeriodNote({ ...target, payload: { note: 'First' }, raw: true });

    const view = await helpers.setBudgetPeriodNote({ ...target, payload: { note: 'Second' }, raw: true });

    expect(view.period.note).toBe('Second');
    expect(await noteAt(target)).toBe('Second');
  });

  it.each([
    ['null', null],
    ['a blank string', '   '],
  ])('clears the note with %s', async (_, note) => {
    const { planId, periods } = await setup();
    const target = { planId, periodId: periods[1]!.id };
    await helpers.setBudgetPeriodNote({ ...target, payload: { note: 'To clear' }, raw: true });

    const view = await helpers.setBudgetPeriodNote({ ...target, payload: { note }, raw: true });

    expect(view.period.note).toBeNull();
    expect(await noteAt(target)).toBeNull();
  });

  it('accepts 1000 characters and rejects 1001 or an invalid body', async () => {
    const { planId, periods } = await setup();
    const target = { planId, periodId: periods[1]!.id };

    const ok = await helpers.setBudgetPeriodNote({ ...target, payload: { note: 'a'.repeat(1000) }, raw: true });
    expect(ok.period.note).toHaveLength(1000);

    for (const payload of [{ note: 'a'.repeat(1001) }, {}, { note: 5 }, { note: 'x', extra: 1 }]) {
      const res = await helpers.setBudgetPeriodNote({ ...target, payload });
      expect({ payload, statusCode: res.statusCode }).toEqual({ payload, statusCode: ERROR_CODES.ValidationError });
    }
    expect(await noteAt(target)).toHaveLength(1000);
  });

  it('answers 404 for an unknown period', async () => {
    const { planId } = await setup();

    const res = await helpers.setBudgetPeriodNote({
      planId,
      periodId: generateRandomRecordId(),
      payload: { note: 'x' },
    });

    expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it("answers 404 when another user writes a note on the owner's period", async () => {
    const { planId, periods } = await setup();
    const target = { planId, periodId: periods[1]!.id };
    const other = await helpers.provisionSecondUserWithBaseCurrency();

    const res = await helpers.asUser({
      cookies: other.cookies,
      fn: () => helpers.setBudgetPeriodNote({ ...target, payload: { note: 'Intruder' } }),
    });

    expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    expect(await noteAt(target)).toBeNull();
  });
});
