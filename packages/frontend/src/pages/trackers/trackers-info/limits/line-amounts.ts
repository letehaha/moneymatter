import { trimAmountNoise } from '@/js/helpers/currency-decimals';
import type { TrackerStatsResponse, TrackerLineModel } from '@bt/shared/types';

interface LineRow {
  line: TrackerLineModel;
  spent: number;
  limit: number | null;
  /** null without a limit; negative when over the limit. */
  left: number | null;
  /** spent / limit in percent, null without a limit. */
  percent: number | null;
  isOver: boolean;
}

interface LinesTotals {
  /** Sum of the lines that have a limit; null when none has one. */
  limitSum: number | null;
  /** Lines plus "Other" spending. */
  spent: number;
  left: number | null;
}

// Decimal sums drift (0.1 + 0.2), which would flag a line exactly at its limit as over.
// `|| 0` turns -0 into 0.
const roundAmount = ({ value, decimals }: { value: number; decimals: number }) =>
  trimAmountNoise({ value, decimals }) || 0;

export const buildLineRows = ({
  lines,
  stats,
  decimals,
}: {
  lines: TrackerLineModel[];
  stats: TrackerStatsResponse | undefined;
  /** Decimals of the base currency the limits and spending are in. */
  decimals: number;
}): LineRow[] => {
  const spentByLine = new Map<string, number>((stats?.lines ?? []).map((item) => [item.lineId, item.spent]));

  return [...lines]
    .sort((a, b) => a.position - b.position)
    .map((line) => {
      const spent = spentByLine.get(line.id) ?? 0;
      const limit = line.limitAmount;
      if (limit === null) return { line, spent, limit, left: null, percent: null, isOver: false };

      const left = roundAmount({ value: limit - spent, decimals });
      const percent = limit > 0 ? (spent / limit) * 100 : spent > 0 ? 100 : 0;
      return { line, spent, limit, left, percent, isOver: left < 0 };
    });
};

export const buildLinesTotals = ({
  rows,
  otherSpent,
  decimals,
}: {
  rows: LineRow[];
  otherSpent: number;
  decimals: number;
}): LinesTotals => {
  const limited = rows.filter((row) => row.limit !== null);
  const limitSum = limited.length
    ? roundAmount({ value: limited.reduce((sum, row) => sum + row.limit!, 0), decimals })
    : null;
  const spent = roundAmount({ value: rows.reduce((sum, row) => sum + row.spent, 0) + otherSpent, decimals });

  return { limitSum, spent, left: limitSum === null ? null : roundAmount({ value: limitSum - spent, decimals }) };
};
