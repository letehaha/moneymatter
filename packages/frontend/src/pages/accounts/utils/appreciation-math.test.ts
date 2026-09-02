import { addMonths, addYears } from 'date-fns';
import { describe, expect, it } from 'vitest';

import { buildAppreciationTimeline, samplePropertyValueAt } from './appreciation-math';

const purchaseDate = new Date('2024-01-15T00:00:00Z');
const purchaseValue = 400_000;

describe('samplePropertyValueAt', () => {
  it('returns the anchor value at and before the anchor date', () => {
    expect(
      samplePropertyValueAt({
        anchorValue: purchaseValue,
        anchorDate: purchaseDate,
        asOf: purchaseDate,
        annualRatePct: 5,
      }),
    ).toBe(purchaseValue);

    expect(
      samplePropertyValueAt({
        anchorValue: purchaseValue,
        anchorDate: purchaseDate,
        asOf: new Date('2023-01-15T00:00:00Z'),
        annualRatePct: 5,
      }),
    ).toBe(purchaseValue);
  });

  it('compounds a positive rate over roughly one year', () => {
    const value = samplePropertyValueAt({
      anchorValue: purchaseValue,
      anchorDate: purchaseDate,
      asOf: addYears(purchaseDate, 1),
      annualRatePct: 5,
    });

    expect(value).toBeCloseTo(purchaseValue * Math.pow(1.05, 366 / 365.25), 0);
  });

  it('shrinks the value on a negative rate and never goes below zero', () => {
    const declining = samplePropertyValueAt({
      anchorValue: purchaseValue,
      anchorDate: purchaseDate,
      asOf: addYears(purchaseDate, 5),
      annualRatePct: -10,
    });

    expect(declining).toBeLessThan(purchaseValue);
    expect(declining).toBeGreaterThan(0);
  });

  it('holds flat at a zero rate', () => {
    expect(
      samplePropertyValueAt({
        anchorValue: purchaseValue,
        anchorDate: purchaseDate,
        asOf: addYears(purchaseDate, 10),
        annualRatePct: 0,
      }),
    ).toBeCloseTo(purchaseValue, 6);
  });
});

describe('buildAppreciationTimeline', () => {
  describe('no revaluation', () => {
    it('returns a single segment of length monthsHorizon + 1 (anchor + one point per month)', () => {
      const monthsHorizon = 24;
      const timeline = buildAppreciationTimeline({
        purchase: { value: purchaseValue, date: purchaseDate },
        monthsHorizon,
        annualRatePct: 4,
      });

      expect(timeline).toHaveLength(monthsHorizon + 1);
    });

    it('treats a null revaluation as no revaluation', () => {
      const monthsHorizon = 12;
      const withNull = buildAppreciationTimeline({
        purchase: { value: purchaseValue, date: purchaseDate },
        revaluation: null,
        monthsHorizon,
        annualRatePct: 4,
      });
      const withoutKey = buildAppreciationTimeline({
        purchase: { value: purchaseValue, date: purchaseDate },
        monthsHorizon,
        annualRatePct: 4,
      });

      expect(withNull).toEqual(withoutKey);
    });

    it('starts at the purchase value and rises monotonically at a positive rate', () => {
      const timeline = buildAppreciationTimeline({
        purchase: { value: purchaseValue, date: purchaseDate },
        monthsHorizon: 36,
        annualRatePct: 4,
      });

      expect(timeline[0]!.value).toBe(purchaseValue);
      for (let i = 1; i < timeline.length; i += 1) {
        expect(timeline[i]!.value).toBeGreaterThan(timeline[i - 1]!.value);
      }
    });

    it('falls monotonically at a negative rate', () => {
      const timeline = buildAppreciationTimeline({
        purchase: { value: purchaseValue, date: purchaseDate },
        monthsHorizon: 36,
        annualRatePct: -4,
      });

      for (let i = 1; i < timeline.length; i += 1) {
        expect(timeline[i]!.value).toBeLessThan(timeline[i - 1]!.value);
      }
    });
  });

  describe('with a revaluation', () => {
    const revaluationDate = addMonths(purchaseDate, 18);

    it('emits two points on the revaluation date so the chart draws a vertical kink', () => {
      const timeline = buildAppreciationTimeline({
        purchase: { value: purchaseValue, date: purchaseDate },
        revaluation: { value: 520_000, date: revaluationDate },
        monthsHorizon: 12,
        annualRatePct: 4,
      });

      const onRevaluationDate = timeline.filter((p) => p.date.getTime() === revaluationDate.getTime());
      expect(onRevaluationDate).toHaveLength(2);
      expect(onRevaluationDate[1]!.value).toBe(520_000);
    });

    it('projects forward from the revalued amount, not the purchase price', () => {
      const timeline = buildAppreciationTimeline({
        purchase: { value: purchaseValue, date: purchaseDate },
        revaluation: { value: 520_000, date: revaluationDate },
        monthsHorizon: 12,
        annualRatePct: 4,
      });

      expect(timeline[timeline.length - 1]!.value).toBeGreaterThan(520_000);
    });

    it('ignores a revaluation dated at or before purchase', () => {
      const timeline = buildAppreciationTimeline({
        purchase: { value: purchaseValue, date: purchaseDate },
        revaluation: { value: 999_999, date: purchaseDate },
        monthsHorizon: 12,
        annualRatePct: 4,
      });

      expect(timeline[0]!.value).toBe(purchaseValue);
      expect(timeline.some((p) => p.value === 999_999)).toBe(false);
    });
  });
});
