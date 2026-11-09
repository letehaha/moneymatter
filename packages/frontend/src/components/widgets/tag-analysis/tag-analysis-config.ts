import type { DashboardWidgetConfig } from '@/api/user-settings';

export type TagAnalysisPercentBase = 'tags' | 'income';

export interface TagAnalysisConfig {
  tagIds: string[];
  targets: Record<string, number>;
  includeTransfers: boolean;
  percentBase: TagAnalysisPercentBase;
}

export interface TagShare {
  tagId: string;
  amount: number;
  percent: number | null;
  target: number | null;
  isOverTarget: boolean;
}

export interface TagSharesSummary {
  rows: TagShare[];
  total: number;
  /** Selected tags' total as a share of income; `null` on the tags base or when income is zero. */
  incomePercent: number | null;
  /** Income not covered by the selected tags; always 0 on the tags base. */
  remaining: number;
}

const isPercent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

export const readTagAnalysisConfig = ({
  widgetConfig,
}: {
  widgetConfig: DashboardWidgetConfig | null | undefined;
}): TagAnalysisConfig => {
  const config = widgetConfig?.config;
  const rawTagIds = config?.tagIds;
  const rawTargets = config?.targets;

  return {
    tagIds: Array.isArray(rawTagIds) ? rawTagIds.filter((id): id is string => typeof id === 'string') : [],
    targets:
      rawTargets && typeof rawTargets === 'object'
        ? Object.fromEntries(Object.entries(rawTargets).filter(([, value]) => isPercent(value)))
        : {},
    includeTransfers: config?.includeTransfers === true,
    percentBase: config?.percentBase === 'income' ? 'income' : 'tags',
  };
};

/** A transaction with several tags counts fully in each, so the tags base can exceed real spending. */
export const buildTagShares = ({
  tagIds,
  totalsByTagId,
  targets,
  percentBase,
  incomeTotal,
}: {
  tagIds: string[];
  totalsByTagId: Record<string, number>;
  targets: Record<string, number>;
  percentBase: TagAnalysisPercentBase;
  incomeTotal: number | null;
}): TagSharesSummary => {
  const amounts = tagIds.map((tagId) => totalsByTagId[tagId] ?? 0);
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const base = percentBase === 'income' ? (incomeTotal ?? 0) : total;

  const rows = tagIds.map((tagId, index) => {
    const amount = amounts[index]!;
    const percent = base > 0 ? (amount / base) * 100 : null;
    const target = targets[tagId] ?? null;

    return {
      tagId,
      amount,
      percent,
      target,
      isOverTarget: percent !== null && target !== null && percent > target,
    };
  });

  const isIncomeBase = percentBase === 'income' && base > 0;

  return {
    rows,
    total,
    incomePercent: isIncomeBase ? (total / base) * 100 : null,
    remaining: isIncomeBase ? Math.max(base - total, 0) : 0,
  };
};
