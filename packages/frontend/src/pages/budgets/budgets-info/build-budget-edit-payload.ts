import type { EditBudgetPayload } from '@/api/budgets';

interface BudgetEditFormValues {
  name: string;
  limitAmount: number | string | null | undefined;
  startDate: Date | null;
  endDate: Date | null;
  /** Only for category trackers. */
  categoryIds?: string[];
}

export type BudgetEditPayload = Required<Pick<EditBudgetPayload, 'name' | 'limitAmount' | 'startDate' | 'endDate'>> &
  Pick<EditBudgetPayload, 'categoryIds'>;

/** Anything but a positive finite number clears the limit (`null`). */
export const buildBudgetEditPayload = ({
  name,
  limitAmount,
  startDate,
  endDate,
  categoryIds,
}: BudgetEditFormValues): BudgetEditPayload => {
  const limit = limitAmount === '' || limitAmount == null ? NaN : Number(limitAmount);

  return {
    name,
    limitAmount: Number.isFinite(limit) && limit > 0 ? limit : null,
    startDate: startDate ? startDate.toISOString() : null,
    endDate: endDate ? endDate.toISOString() : null,
    ...(categoryIds ? { categoryIds } : {}),
  };
};
