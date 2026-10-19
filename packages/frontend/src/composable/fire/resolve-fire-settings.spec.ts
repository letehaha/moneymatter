import type { FireSettings } from '@bt/shared/types';
import type { PortfolioAnnualizedReturnModel } from '@bt/shared/types/investments/portfolio-annualized-return.model';
import { describe, expect, it } from 'vitest';

import { toRealAnnual } from './fire-math';
import { resolveFireSettings } from './resolve-fire-settings';

const WORLD_STOCK_REAL = toRealAnnual({ nominalPct: 8, inflationPct: 3 });

const portfolio = (overrides: Partial<PortfolioAnnualizedReturnModel> = {}): PortfolioAnnualizedReturnModel => ({
  portfolioId: 'p1',
  portfolioName: 'Main',
  annualizedReturn: 11,
  hasEnoughHistory: true,
  startDate: '2020-01-01',
  periodDays: 800,
  currencyCode: 'USD',
  ...overrides,
});

const resolve = ({
  fire,
  portfolioReturns = [],
}: {
  fire: Parameters<typeof resolveFireSettings>[0]['fire'];
  portfolioReturns?: PortfolioAnnualizedReturnModel[];
}) => resolveFireSettings({ fire, portfolioReturns });

describe('resolveFireSettings', () => {
  it('fills defaults for a missing slice', () => {
    expect(resolve({ fire: undefined })).toEqual({
      annualSpendingOverride: null,
      monthlyContributionOverride: null,
      spendingExcludedCategoryIds: [],
      includeVentures: false,
      includeVehicles: false,
      includeProperties: false,
      includeLoans: false,
      returnIndicatorId: 'world-stock',
      customReturnPct: null,
      inflationPct: 3,
      withdrawalRatePct: 4,
      leanMultiplier: 0.7,
      fatMultiplier: 1.5,
      baristaMonthlyIncome: null,
      birthYear: null,
      coastTargetAge: 65,
      targetType: 'regular',
      realAnnual: WORLD_STOCK_REAL,
      effectiveInflationPct: 3,
      returnFallback: null,
      returnPeriodDays: null,
    });
  });

  it('keeps the include-properties toggle', () => {
    expect(resolve({ fire: { includeProperties: true } }).includeProperties).toBe(true);
    expect(resolve({ fire: { includeProperties: false } }).includeProperties).toBe(false);
  });

  it('treats out-of-range values as absent', () => {
    const resolved = resolve({
      fire: {
        withdrawalRatePct: 0,
        leanMultiplier: 1.2,
        fatMultiplier: 3,
        inflationPct: 99,
        coastTargetAge: 10,
        birthYear: 1800,
        annualSpendingOverride: -5,
        monthlyContributionOverride: -200,
      },
    });
    expect(resolved).toMatchObject({
      withdrawalRatePct: 4,
      leanMultiplier: 0.7,
      fatMultiplier: 3,
      inflationPct: 3,
      coastTargetAge: 65,
      birthYear: null,
      annualSpendingOverride: null,
      monthlyContributionOverride: -200,
    });
  });

  it('keeps the selected target type', () => {
    expect(resolve({ fire: { targetType: 'lean' } }).targetType).toBe('lean');
    expect(resolve({ fire: { targetType: 'fat' } }).targetType).toBe('fat');
  });

  it('falls back to the default for an unknown target type', () => {
    const fire = JSON.parse('{"targetType":"obese"}') as FireSettings;
    expect(resolve({ fire }).targetType).toBe('regular');
  });

  it.each([NaN, Infinity, -Infinity])('treats a non-finite %s as absent', (value) => {
    expect(
      resolve({
        fire: { monthlyContributionOverride: value, annualSpendingOverride: value, baristaMonthlyIncome: value },
      }),
    ).toMatchObject({ monthlyContributionOverride: null, annualSpendingOverride: null, baristaMonthlyIncome: null });
  });

  it('preset return ignores user inflation and uses 3%', () => {
    const resolved = resolve({
      fire: { returnIndicatorId: 'sp500', inflationPct: 10 },
    });
    expect(resolved.realAnnual).toBeCloseTo(toRealAnnual({ nominalPct: 10, inflationPct: 3 }), 12);
    expect(resolved.effectiveInflationPct).toBe(3);
    expect(resolved.inflationPct).toBe(10);
  });

  it('portfolio return uses its TWR with user inflation and exposes the period', () => {
    const resolved = resolve({
      fire: { returnIndicatorId: 'portfolio:p1', inflationPct: 5 },
      portfolioReturns: [portfolio()],
    });
    expect(resolved.realAnnual).toBeCloseTo(toRealAnnual({ nominalPct: 11, inflationPct: 5 }), 12);
    expect(resolved.effectiveInflationPct).toBe(5);
    expect(resolved.returnPeriodDays).toBe(800);
    expect(resolved.returnFallback).toBeNull();
  });

  it('stale or null portfolio return falls back to world-stock', () => {
    for (const portfolioReturns of [[], [portfolio({ annualizedReturn: null })]]) {
      const resolved = resolve({
        fire: { returnIndicatorId: 'portfolio:p1', inflationPct: 5 },
        portfolioReturns,
      });
      expect(resolved.realAnnual).toBeCloseTo(WORLD_STOCK_REAL, 12);
      expect(resolved.effectiveInflationPct).toBe(3);
      expect(resolved.returnFallback).toBe('portfolio-unavailable');
      expect(resolved.returnIndicatorId).toBe('portfolio:p1');
    }
  });

  it('custom return uses user inflation; null falls back to world-stock', () => {
    const custom = resolve({
      fire: {
        returnIndicatorId: 'custom',
        customReturnPct: 7,
        inflationPct: 2,
      },
    });
    expect(custom.realAnnual).toBeCloseTo(toRealAnnual({ nominalPct: 7, inflationPct: 2 }), 12);
    expect(custom.returnFallback).toBeNull();

    const missing = resolve({
      fire: { returnIndicatorId: 'custom', customReturnPct: null },
    });
    expect(missing.realAnnual).toBeCloseTo(WORLD_STOCK_REAL, 12);
    expect(missing.returnFallback).toBe('custom-missing');
  });
});
