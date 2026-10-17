import type { BudgetStatsResponse, TrackerLineModel } from '@bt/shared/types';

export interface LineRow {
  line: TrackerLineModel;
  spent: number;
  limit: number | null;
  /** null without a limit; negative when over the limit. */
  left: number | null;
  /** spent / limit in percent, null without a limit. */
  percent: number | null;
  isOver: boolean;
}

export interface LinesTotals {
  /** Sum of the lines that have a limit; null when none has one. */
  limitSum: number | null;
  /** Lines plus "Other" spending. */
  spent: number;
  left: number | null;
}

// Decimal sums drift (0.1 + 0.2), which would flag a line exactly at its limit as over.
const roundAmount = (value: number) => Math.round(value * 100) / 100 || 0;

export const buildLineRows = ({
  lines,
  stats,
}: {
  lines: TrackerLineModel[];
  stats: BudgetStatsResponse | undefined;
}): LineRow[] => {
  const spentByLine = new Map<string, number>((stats?.lines ?? []).map((item) => [item.lineId, item.spent]));

  return [...lines]
    .sort((a, b) => a.position - b.position)
    .map((line) => {
      const spent = spentByLine.get(line.id) ?? 0;
      const limit = line.limitAmount;
      if (limit === null) return { line, spent, limit, left: null, percent: null, isOver: false };

      const left = roundAmount(limit - spent);
      const percent = limit > 0 ? (spent / limit) * 100 : spent > 0 ? 100 : 0;
      return { line, spent, limit, left, percent, isOver: left < 0 };
    });
};

export const buildLinesTotals = ({ rows, otherSpent }: { rows: LineRow[]; otherSpent: number }): LinesTotals => {
  const limited = rows.filter((row) => row.limit !== null);
  const limitSum = limited.length ? roundAmount(limited.reduce((sum, row) => sum + row.limit!, 0)) : null;
  const spent = roundAmount(rows.reduce((sum, row) => sum + row.spent, 0) + otherSpent);

  return { limitSum, spent, left: limitSum === null ? null : roundAmount(limitSum - spent) };
};
