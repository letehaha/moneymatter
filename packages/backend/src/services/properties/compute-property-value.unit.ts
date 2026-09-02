import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';

import { computePropertyValue } from './compute-property-value';

/**
 * Unit tests for the pure `computePropertyValue` appreciation math.
 *
 * The function is side-effect-free: no DB, no clock — the caller supplies every
 * input including `asOf`. Expectations are computed from the same closed-form
 * formula the implementation uses, so they stay correct if the day-count
 * convention changes.
 */
describe('computePropertyValue', () => {
  const anchorDate = new Date('2023-01-01T00:00:00Z');
  const anchorValue = Money.fromDecimal(400_000);

  describe('boundary dates', () => {
    it('returns anchor value unchanged when asOf is before anchorDate', () => {
      const result = computePropertyValue({
        anchorValue,
        anchorDate,
        asOf: new Date('2022-06-15T00:00:00Z'),
        annualRatePct: 5,
      });

      expect(result.toNumber()).toBe(400_000);
    });

    it('returns anchor value unchanged when asOf is exactly anchorDate', () => {
      const result = computePropertyValue({
        anchorValue,
        anchorDate,
        asOf: anchorDate,
        annualRatePct: 5,
      });

      expect(result.toNumber()).toBe(400_000);
    });
  });

  describe('positive rates', () => {
    it('grows by roughly the annual rate after one year', () => {
      const result = computePropertyValue({
        anchorValue,
        anchorDate,
        asOf: new Date('2024-01-01T00:00:00Z'),
        annualRatePct: 5,
      });

      // 365 days over a 365.25-day year is a hair under a full year.
      expect(result.toNumber()).toBeCloseTo(400_000 * Math.pow(1.05, 365 / 365.25), 0);
    });

    it('compounds across multiple years', () => {
      const result = computePropertyValue({
        anchorValue,
        anchorDate,
        asOf: new Date('2033-01-01T00:00:00Z'),
        annualRatePct: 5,
      });

      const days = 3653;
      expect(result.toNumber()).toBeCloseTo(400_000 * Math.pow(1.05, days / 365.25), 0);
    });

    it('moves partway through a year rather than stepping on the anniversary', () => {
      const halfway = computePropertyValue({
        anchorValue,
        anchorDate,
        asOf: new Date('2023-07-02T00:00:00Z'),
        annualRatePct: 10,
      });

      expect(halfway.toNumber()).toBeGreaterThan(400_000);
      expect(halfway.toNumber()).toBeLessThan(440_000);
    });
  });

  describe('negative rates', () => {
    it('shrinks the value when the rate is negative', () => {
      const result = computePropertyValue({
        anchorValue,
        anchorDate,
        asOf: new Date('2024-01-01T00:00:00Z'),
        annualRatePct: -8,
      });

      expect(result.toNumber()).toBeCloseTo(400_000 * Math.pow(0.92, 365 / 365.25), 0);
    });

    it('never returns a negative value', () => {
      const result = computePropertyValue({
        anchorValue,
        anchorDate,
        asOf: new Date('2223-01-01T00:00:00Z'),
        annualRatePct: -20,
      });

      expect(result.isNegative()).toBe(false);
    });
  });

  describe('zero rate', () => {
    it('holds the anchor value flat', () => {
      const result = computePropertyValue({
        anchorValue,
        anchorDate,
        asOf: new Date('2030-01-01T00:00:00Z'),
        annualRatePct: 0,
      });

      expect(result.toNumber()).toBe(400_000);
    });
  });
});
