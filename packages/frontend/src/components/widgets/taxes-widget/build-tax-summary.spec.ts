import type { RecordId, endpointsTypes } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { OTHER_SEGMENT_ID, buildTaxSummary, withDirectChildren } from './build-tax-summary';

const period = ({
  month,
  income = 0,
  categories = {},
}: {
  month: string;
  income?: number;
  categories?: Record<string, number>;
}): endpointsTypes.CashFlowPeriodData => ({
  periodStart: `2026-${month}-01`,
  periodEnd: `2026-${month}-28`,
  income,
  expenses: 0,
  netFlow: 0,
  categories: Object.entries(categories).map(([categoryId, expenseAmount]) => ({
    categoryId: categoryId as RecordId,
    name: categoryId,
    color: '#000',
    incomeAmount: 0,
    expenseAmount,
  })),
});

describe('buildTaxSummary', () => {
  it('computes the rate of the latest window months against all months', () => {
    const summary = buildTaxSummary({
      allPeriods: [period({ month: '08', income: 1000 }), period({ month: '09', income: 2000 })],
      taxPeriods: [
        period({ month: '08', categories: { income: 100 } }),
        period({ month: '09', categories: { income: 400, property: 100 } }),
      ],
      windowMonths: 1,
    });

    expect(summary.current).toEqual({ taxes: 500, income: 2000, rate: 0.25 });
    expect(summary.trailing).toEqual({ taxes: 600, income: 3000, rate: 0.2 });
    expect(summary.averageTaxes).toBe(500);
    expect(summary.maxTaxes).toBe(500);
    expect(summary.months.map((m) => m.rate)).toEqual([0.1, 0.25]);
    expect(summary.months.map((m) => m.isCurrent)).toEqual([false, true]);
    expect(summary.segments.map((s) => [s.id, s.value, s.share])).toEqual([
      ['income', 400, 0.8],
      ['property', 100, 0.2],
    ]);
  });

  it('folds everything past the top three categories into one other segment', () => {
    const summary = buildTaxSummary({
      allPeriods: [period({ month: '09', income: 1000 })],
      taxPeriods: [period({ month: '09', categories: { a: 50, b: 40, c: 30, d: 20, e: 10 } })],
      windowMonths: 12,
    });

    expect(summary.segments.map((s) => s.id)).toEqual(['a', 'b', 'c', OTHER_SEGMENT_ID]);
    const other = summary.segments.at(-1)!;
    expect(other.value).toBe(30);
    expect(other.share).toBe(0.2);
    expect(other.children?.map((s) => s.id)).toEqual(['d', 'e']);
  });

  it('keeps four categories as four segments', () => {
    const summary = buildTaxSummary({
      allPeriods: [period({ month: '09', income: 1000 })],
      taxPeriods: [period({ month: '09', categories: { a: 40, b: 30, c: 20, d: 10 } })],
      windowMonths: 12,
    });

    expect(summary.segments.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sums a category across the window months and leaves older months out of the breakdown', () => {
    const summary = buildTaxSummary({
      allPeriods: [],
      taxPeriods: [
        period({ month: '07', categories: { old: 500 } }),
        period({ month: '08', categories: { income: 100 } }),
        period({ month: '09', categories: { income: 300 } }),
      ],
      windowMonths: 2,
    });

    expect(summary.averageTaxes).toBe(200);
    expect(summary.segments.map((s) => [s.id, s.value])).toEqual([['income', 400]]);
  });

  it('nets a refund against the payments of other months and categories', () => {
    const summary = buildTaxSummary({
      allPeriods: [period({ month: '08', income: 1000 }), period({ month: '09', income: 1000 })],
      taxPeriods: [
        period({ month: '08', categories: { income: 1000 } }),
        period({ month: '09', categories: { income: -400, property: 100 } }),
      ],
      windowMonths: 12,
    });

    expect(summary.months.map((m) => m.taxes)).toEqual([1000, -300]);
    expect(summary.current).toEqual({ taxes: 700, income: 2000, rate: 0.35 });
    expect(summary.segments.map((s) => [s.id, s.value])).toEqual([
      ['income', 600],
      ['property', 100],
    ]);
  });

  it('reports no taxes for a net refund and no rate without income', () => {
    const summary = buildTaxSummary({
      allPeriods: [],
      taxPeriods: [period({ month: '09', categories: { income: -200 } })],
      windowMonths: 12,
    });

    expect(summary.current).toEqual({ taxes: 0, income: 0, rate: null });
    expect(summary.maxTaxes).toBe(0);
    expect(summary.segments).toEqual([]);
  });

  it('handles no periods at all', () => {
    const summary = buildTaxSummary({ allPeriods: [], taxPeriods: [], windowMonths: 12 });

    expect(summary.months).toEqual([]);
    expect(summary.averageTaxes).toBe(0);
  });
});

describe('withDirectChildren', () => {
  it('adds the direct children of a selected parent once', () => {
    expect(
      withDirectChildren({
        categoryIds: ['taxes', 'income-tax'],
        categories: [
          { id: 'taxes', parentId: null },
          { id: 'income-tax', parentId: 'taxes' },
          { id: 'vat', parentId: 'taxes' },
          { id: 'food', parentId: null },
        ],
      }),
    ).toEqual(['taxes', 'income-tax', 'vat']);
  });
});
