import type { endpointsTypes } from '@bt/shared/types';

export const OTHER_SEGMENT_ID = 'other';
/** Segments shown in the breakdown bar; past this the smallest fold into one "other" segment. */
const MAX_SEGMENTS = 4;

export interface TaxSegment {
  id: string;
  name: string;
  color: string;
  value: number;
  /** Share of the averaging window's taxes. */
  share: number;
  /** Categories folded into the "other" segment, largest first. */
  children?: TaxSegment[];
}

export interface TaxMonth {
  periodStart: string;
  /** Net of refunds, so negative when a refund lands in a later month than its payment. */
  taxes: number;
  income: number;
  rate: number | null;
  isCurrent: boolean;
}

interface TaxTotals {
  taxes: number;
  income: number;
  /** Taxes as a share of income, null when the range earned nothing. */
  rate: number | null;
}

export interface TaxSummary {
  months: TaxMonth[];
  current: TaxTotals;
  trailing: TaxTotals;
  /** Monthly average over the averaging window. */
  averageTaxes: number;
  /** Largest monthly amount, the scale the trend bars and the average line share. */
  maxTaxes: number;
  segments: TaxSegment[];
}

const rateOf = ({ taxes, income }: { taxes: number; income: number }) => (income > 0 ? taxes / income : null);

const totals = ({ months }: { months: TaxMonth[] }): TaxTotals => {
  const taxes = Math.max(
    0,
    months.reduce((sum, m) => sum + m.taxes, 0),
  );
  const income = months.reduce((sum, m) => sum + m.income, 0);
  return { taxes, income, rate: rateOf({ taxes, income }) };
};

/**
 * The cash-flow endpoint reports each leg under its nearest requested ancestor, so requesting the
 * direct children too splits a single selected parent into its subcategories.
 */
export const withDirectChildren = <Id extends string>({
  categoryIds,
  categories,
}: {
  categoryIds: Id[];
  categories: { id: Id; parentId?: Id | null }[];
}): Id[] => {
  const selected = new Set(categoryIds);
  const children = categories.filter((c) => c.parentId && selected.has(c.parentId)).map((c) => c.id);
  return [...new Set([...selected, ...children])];
};

/**
 * `taxPeriods` must come from a cash-flow request filtered to the tax categories, `allPeriods`
 * from the same range unfiltered.
 */
export const buildTaxSummary = ({
  allPeriods,
  taxPeriods,
  windowMonths,
}: {
  allPeriods: endpointsTypes.CashFlowPeriodData[];
  taxPeriods: endpointsTypes.CashFlowPeriodData[];
  /** How many of the latest months the headline rate and the breakdown cover. */
  windowMonths: number;
}): TaxSummary => {
  const incomeByStart = new Map(allPeriods.map((p) => [p.periodStart, p.income]));
  const byCategory = new Map<string, TaxSegment>();

  const months = taxPeriods.map((period, index): TaxMonth => {
    const isCurrent = index >= taxPeriods.length - windowMonths;
    let taxes = 0;
    for (const category of period.categories ?? []) {
      const value = category.expenseAmount;
      taxes += value;
      if (!isCurrent) continue;
      const segment = byCategory.get(category.categoryId) ?? {
        id: category.categoryId,
        name: category.name,
        color: category.color,
        value: 0,
        share: 0,
      };
      segment.value += value;
      byCategory.set(category.categoryId, segment);
    }
    const income = incomeByStart.get(period.periodStart) ?? 0;
    return { periodStart: period.periodStart, taxes, income, rate: rateOf({ taxes, income }), isCurrent };
  });

  const windowed = months.filter((m) => m.isCurrent);
  const current = totals({ months: windowed });
  const trailing = totals({ months });

  // A category refunded more than it was charged has nothing to show in the breakdown.
  const paid = [...byCategory.values()].filter((segment) => segment.value > 0);
  const paidTotal = paid.reduce((sum, s) => sum + s.value, 0);
  const sorted = paid
    .map((segment) => ({ ...segment, share: segment.value / paidTotal }))
    .sort((a, b) => b.value - a.value);
  const kept = sorted.length > MAX_SEGMENTS ? sorted.slice(0, MAX_SEGMENTS - 1) : sorted;
  const rest = sorted.slice(kept.length);
  const restValue = rest.reduce((sum, s) => sum + s.value, 0);
  const segments: TaxSegment[] = rest.length
    ? [
        ...kept,
        {
          id: OTHER_SEGMENT_ID,
          name: '',
          // Category colors are user-picked and can repeat, so the folded segment stays neutral.
          color: 'var(--muted-foreground)',
          value: restValue,
          share: restValue / paidTotal,
          children: rest,
        },
      ]
    : kept;

  return {
    months,
    current,
    trailing,
    averageTaxes: windowed.length ? current.taxes / windowed.length : 0,
    maxTaxes: Math.max(0, ...months.map((m) => m.taxes)),
    segments,
  };
};
