import { describe, expect, it } from '@jest/globals';

import type { PeriodCadenceConfig } from '../periods/period-enumerator';
import { GoalAskLine, GoalPeriodAssigned, GoalSpec, evaluateGoal } from './goal-ask';

const PERIOD = '2026-09-01';

const MONTHLY: PeriodCadenceConfig = {
  cadence: 'months',
  intervalN: 1,
  anchorDate: '2026-01-01',
  secondAnchorDay: null,
};

const monthEnd = ({ start }: { start: string }) => {
  const [year, month] = start.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
};

const evaluate = ({
  goal,
  line = {},
  start = PERIOD,
  history = [],
}: {
  goal: Partial<GoalSpec> & Pick<GoalSpec, 'frequency' | 'behavior' | 'amount'>;
  line?: Partial<GoalAskLine>;
  start?: string;
  history?: GoalPeriodAssigned[];
}) =>
  evaluateGoal({
    goal: {
      weekday: null,
      anchorDate: null,
      repeatEvery: null,
      repeatUnit: null,
      stopAtBalance: null,
      fundingCap: null,
      startPeriodStart: PERIOD,
      snoozedPeriodStart: null,
      ...goal,
    },
    line: { carriedIn: 0, assigned: 0, activity: 0, available: 0, ...line },
    period: { start, end: monthEnd({ start }) },
    history,
    plan: MONTHLY,
  });

describe('evaluateGoal', () => {
  describe('every_period', () => {
    it('budget_another asks for what this period has not assigned', () => {
      expect(
        evaluate({
          goal: { frequency: 'every_period', behavior: 'budget_another', amount: 10_000 },
          line: { assigned: 4_000, carriedIn: 9_000, available: 13_000 },
        }),
      ).toEqual({
        ask: 6_000,
        target: 10_000,
        progress: 4_000,
        status: 'underfunded',
        periodTarget: 10_000,
        budgetAmount: 6_000,
        dueDate: null,
        occurrences: null,
        fundedThrough: null,
        nextNeededDate: null,
        fundingPlan: null,
      });
    });

    it('refill_up_to counts the carried-in money', () => {
      expect(
        evaluate({
          goal: { frequency: 'every_period', behavior: 'refill_up_to', amount: 10_000 },
          line: { carriedIn: 3_000, assigned: 2_000, activity: -1_000, available: 4_000 },
        }),
      ).toMatchObject({ ask: 5_000, progress: 5_000, status: 'underfunded' });
    });

    it('refill_up_to is funded when the carry covers it', () => {
      expect(
        evaluate({
          goal: { frequency: 'every_period', behavior: 'refill_up_to', amount: 10_000 },
          line: { carriedIn: 15_000, available: 15_000 },
        }),
      ).toMatchObject({ ask: 0, status: 'funded' });
    });
  });

  describe('weekly', () => {
    it('multiplies by 5 Tuesdays in September 2026', () => {
      expect(
        evaluate({ goal: { frequency: 'weekly', behavior: 'budget_another', amount: 5_000, weekday: 2 } }),
      ).toMatchObject({
        periodTarget: 25_000,
        target: 25_000,
        ask: 25_000,
        occurrences: ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'],
        fundedThrough: null,
        nextNeededDate: '2026-09-01',
      });
    });

    it('multiplies by 4 Mondays and reports funded-through from assigned', () => {
      expect(
        evaluate({
          goal: { frequency: 'weekly', behavior: 'budget_another', amount: 5_000, weekday: 1 },
          line: { assigned: 12_000, carriedIn: 50_000 },
        }),
      ).toMatchObject({
        periodTarget: 20_000,
        ask: 8_000,
        occurrences: ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'],
        fundedThrough: '2026-09-14',
        nextNeededDate: '2026-09-21',
      });
    });

    it('refill_up_to counts carried in toward the occurrences', () => {
      expect(
        evaluate({
          goal: { frequency: 'weekly', behavior: 'refill_up_to', amount: 5_000, weekday: 1 },
          line: { carriedIn: 15_000, assigned: 5_000 },
        }),
      ).toMatchObject({ ask: 0, status: 'funded', fundedThrough: '2026-09-28', nextNeededDate: null });
    });
  });

  describe('biweekly', () => {
    it('steps forward from an anchor before the period', () => {
      expect(
        evaluate({
          goal: { frequency: 'biweekly', behavior: 'budget_another', amount: 7_000, anchorDate: '2026-08-21' },
        }),
      ).toMatchObject({ occurrences: ['2026-09-04', '2026-09-18'], periodTarget: 14_000, ask: 14_000 });
    });

    it('steps back from an anchor after the period', () => {
      expect(
        evaluate({
          goal: { frequency: 'biweekly', behavior: 'refill_up_to', amount: 7_000, anchorDate: '2026-11-12' },
          line: { carriedIn: 8_000 },
          start: '2026-10-01',
        }),
      ).toMatchObject({
        occurrences: ['2026-10-01', '2026-10-15', '2026-10-29'],
        periodTarget: 21_000,
        ask: 13_000,
        fundedThrough: '2026-10-01',
        nextNeededDate: '2026-10-15',
      });
    });
  });

  describe('yearly', () => {
    const yearly = {
      frequency: 'yearly' as const,
      behavior: 'budget_another' as const,
      amount: 120_000,
      anchorDate: '2027-03-28',
    };

    it('first cycle spreads from the start period to the first due date', () => {
      const result = evaluate({ goal: yearly });
      expect(result).toMatchObject({ dueDate: '2027-03-28', periodTarget: 17_143, ask: 17_143, target: 120_000 });
      expect(result.fundingPlan).toHaveLength(7);
    });

    it('first cycle subtracts what earlier periods assigned', () => {
      expect(
        evaluate({
          goal: yearly,
          start: '2026-11-01',
          line: { assigned: 3_000 },
          history: [
            { start: '2026-09-01', assigned: 17_143 },
            { start: '2026-10-01', assigned: 17_143 },
          ],
        }),
      ).toMatchObject({ periodTarget: 17_143, ask: 14_143, progress: 37_286 });
    });

    it('later cycle starts after the previous due period', () => {
      const result = evaluate({
        goal: yearly,
        start: '2027-06-01',
        history: [
          { start: '2027-03-01', assigned: 99_999 },
          { start: '2027-04-01', assigned: 10_000 },
          { start: '2027-05-01', assigned: 10_000 },
        ],
      });
      expect(result).toMatchObject({ dueDate: '2028-03-28', periodTarget: 10_000, ask: 10_000, progress: 20_000 });
      expect(result.fundingPlan).toHaveLength(10);
    });

    it('refill_up_to aims at the amount by the due date from the balance', () => {
      expect(
        evaluate({
          goal: { ...yearly, behavior: 'refill_up_to' },
          line: { carriedIn: 50_000, activity: -1_000, assigned: 0, available: 49_000 },
        }),
      ).toMatchObject({ periodTarget: 10_143, ask: 10_143 });
    });
  });

  describe('by_date', () => {
    it('reach_balance matches the Zerosum funding plan', () => {
      const result = evaluate({
        goal: { frequency: 'by_date', behavior: 'reach_balance', amount: 650_000, anchorDate: '2027-03-28' },
        line: { carriedIn: 250_000, assigned: 50_000, available: 300_000 },
      });
      expect(result).toMatchObject({ ask: 7_143, periodTarget: 57_143, progress: 300_000, status: 'underfunded' });
      expect(result.fundingPlan).toEqual([
        { periodStart: '2026-09-01', amount: 7_143, leftAfter: 342_857 },
        { periodStart: '2026-10-01', amount: 57_143, leftAfter: 285_714 },
        { periodStart: '2026-11-01', amount: 57_143, leftAfter: 228_571 },
        { periodStart: '2026-12-01', amount: 57_143, leftAfter: 171_428 },
        { periodStart: '2027-01-01', amount: 57_143, leftAfter: 114_285 },
        { periodStart: '2027-02-01', amount: 57_143, leftAfter: 57_142 },
        { periodStart: '2027-03-01', amount: 57_142, leftAfter: 0 },
      ]);
    });

    it('budget_another spreads the rest of the total over the periods left', () => {
      expect(
        evaluate({
          goal: { frequency: 'by_date', behavior: 'budget_another', amount: 60_000, anchorDate: '2026-12-15' },
          start: '2026-10-01',
          history: [{ start: '2026-09-01', assigned: 15_000 }],
        }),
      ).toMatchObject({ periodTarget: 15_000, ask: 15_000, progress: 15_000, dueDate: '2026-12-15' });
    });

    it('a repeat rolls over to the next cycle after the due period', () => {
      const result = evaluate({
        goal: {
          frequency: 'by_date',
          behavior: 'budget_another',
          amount: 30_000,
          anchorDate: '2026-10-15',
          repeatEvery: 3,
          repeatUnit: 'months',
        },
        start: '2026-11-01',
        history: [
          { start: '2026-09-01', assigned: 15_000 },
          { start: '2026-10-01', assigned: 15_000 },
        ],
      });
      expect(result).toMatchObject({ dueDate: '2027-01-15', periodTarget: 10_000, ask: 10_000, progress: 0 });
      expect(result.fundingPlan?.map((row) => row.periodStart)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    });

    it('a yearly repeat of refill_up_to targets the next due date', () => {
      expect(
        evaluate({
          goal: {
            frequency: 'by_date',
            behavior: 'refill_up_to',
            amount: 12_000,
            anchorDate: '2026-02-10',
            repeatEvery: 1,
            repeatUnit: 'years',
          },
        }),
      ).toMatchObject({ dueDate: '2027-02-10', periodTarget: 2_000, ask: 2_000 });
    });

    it('past due asks everything now with a one-row plan', () => {
      const result = evaluate({
        goal: { frequency: 'by_date', behavior: 'reach_balance', amount: 10_000, anchorDate: '2026-06-30' },
        line: { carriedIn: 4_000, available: 4_000 },
      });
      expect(result).toMatchObject({ ask: 6_000, periodTarget: 6_000, dueDate: '2026-06-30' });
      expect(result.fundingPlan).toEqual([{ periodStart: PERIOD, amount: 6_000, leftAfter: 0 }]);
    });

    it('has no funding plan once achieved', () => {
      expect(
        evaluate({
          goal: { frequency: 'by_date', behavior: 'reach_balance', amount: 10_000, anchorDate: '2027-01-01' },
          line: { carriedIn: 10_000, assigned: 1_000, available: 11_000 },
        }),
      ).toMatchObject({ ask: 0, status: 'achieved', fundingPlan: null });
    });

    it('has no funding plan once the whole total is assigned', () => {
      expect(
        evaluate({
          goal: { frequency: 'by_date', behavior: 'budget_another', amount: 30_000, anchorDate: '2026-12-15' },
          line: { assigned: 10_000 },
          history: [{ start: '2026-09-01', assigned: 20_000 }],
          start: '2026-10-01',
        }),
      ).toMatchObject({ ask: 0, status: 'funded', progress: 30_000, fundingPlan: null });
    });
  });

  describe('open_ended', () => {
    const openEnded = { frequency: 'open_ended' as const, behavior: 'reach_balance' as const, amount: 10_000 };

    it('never asks; the budget button funds the whole gap', () => {
      expect(evaluate({ goal: openEnded, line: { carriedIn: 2_000, available: 2_000 } })).toMatchObject({
        ask: 0,
        periodTarget: 0,
        status: 'funded',
        budgetAmount: 8_000,
        fundingPlan: null,
      });
    });

    it('covers an overspend in the gap', () => {
      expect(evaluate({ goal: openEnded, line: { activity: -500, available: -500 } })).toMatchObject({
        budgetAmount: 10_500,
      });
    });

    it('is achieved at the amount and cannot be snoozed', () => {
      expect(
        evaluate({ goal: { ...openEnded, snoozedPeriodStart: PERIOD }, line: { available: 12_000 } }),
      ).toMatchObject({ status: 'achieved', budgetAmount: 0 });
    });
  });

  describe('options', () => {
    it('stopAtBalance trims the ask to the cap', () => {
      const goal = {
        frequency: 'every_period' as const,
        behavior: 'budget_another' as const,
        amount: 10_000,
        stopAtBalance: 25_000,
      };
      expect(evaluate({ goal, line: { carriedIn: 20_000 } })).toMatchObject({ ask: 5_000 });
      expect(evaluate({ goal, line: { carriedIn: 26_000 } })).toMatchObject({ ask: 0, status: 'funded' });
    });

    it('stopAtBalance stops the funding plan once the projected balance reaches the cap', () => {
      const result = evaluate({
        goal: {
          frequency: 'yearly',
          behavior: 'budget_another',
          amount: 120_000,
          anchorDate: '2027-03-28',
          stopAtBalance: 50_000,
        },
      });
      expect(result).toMatchObject({ ask: 17_143, status: 'underfunded' });
      expect(result.fundingPlan).toEqual([
        { periodStart: '2026-09-01', amount: 17_143, leftAfter: 102_857 },
        { periodStart: '2026-10-01', amount: 17_143, leftAfter: 85_714 },
        { periodStart: '2026-11-01', amount: 15_714, leftAfter: 70_000 },
      ]);
    });

    it('fundingCap limits the refill ask per period', () => {
      expect(
        evaluate({
          goal: { frequency: 'every_period', behavior: 'refill_up_to', amount: 10_000, fundingCap: 3_000 },
        }),
      ).toMatchObject({ ask: 3_000, status: 'underfunded' });
    });

    it('snooze drops the ask and the funding plan for this period only', () => {
      const goal = {
        frequency: 'yearly' as const,
        behavior: 'budget_another' as const,
        amount: 120_000,
        anchorDate: '2027-03-28',
        snoozedPeriodStart: PERIOD,
      };
      expect(evaluate({ goal })).toMatchObject({ ask: 0, status: 'snoozed', fundingPlan: null, budgetAmount: 0 });
      expect(evaluate({ goal, start: '2026-10-01' })).toMatchObject({ status: 'underfunded' });
    });

    it('budgetAmount adds an overspend when the ask ignores activity', () => {
      const overspent = { activity: -2_500, available: -2_500 };
      expect(
        evaluate({ goal: { frequency: 'every_period', behavior: 'budget_another', amount: 10_000 }, line: overspent }),
      ).toMatchObject({ ask: 10_000, budgetAmount: 12_500 });
      expect(
        evaluate({
          goal: { frequency: 'weekly', behavior: 'refill_up_to', amount: 5_000, weekday: 1 },
          line: overspent,
        }),
      ).toMatchObject({ ask: 20_000, budgetAmount: 22_500 });
      expect(
        evaluate({
          goal: { frequency: 'yearly', behavior: 'budget_another', amount: 70_000, anchorDate: '2027-03-28' },
          line: overspent,
        }),
      ).toMatchObject({ ask: 10_000, budgetAmount: 12_500 });
    });

    it('budgetAmount is the ask when the ask is measured from available', () => {
      const overspent = { activity: -7_000, available: -7_000 };
      expect(
        evaluate({
          goal: { frequency: 'by_date', behavior: 'reach_balance', amount: 63_000, anchorDate: '2027-03-28' },
          line: overspent,
        }),
      ).toMatchObject({ ask: 10_000, budgetAmount: 10_000 });
      expect(
        evaluate({
          goal: { frequency: 'yearly', behavior: 'refill_up_to', amount: 63_000, anchorDate: '2027-03-28' },
          line: overspent,
        }),
      ).toMatchObject({ ask: 10_000, budgetAmount: 10_000 });
    });
  });
});
