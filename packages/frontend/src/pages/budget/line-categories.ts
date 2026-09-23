import { type FormattedCategory } from '@/common/types';
import { flattenCategories } from '@/components/common/combobox-categories.helpers';
import type { BudgetPlanLineEntry } from '@bt/shared/types';

export const collapseCategoryIds = ({
  categoryIds,
  categories,
}: {
  categoryIds: string[];
  categories: FormattedCategory[];
}): string[] => {
  const flat = flattenCategories({ categories });
  const selected = new Set(categoryIds);
  const covered = new Set<string>();
  const result: string[] = [];

  for (const item of flat) {
    if (covered.has(item.id) || !selected.has(item.id)) continue;
    if (item.descendantIds.every((id) => selected.has(id))) {
      result.push(item.id);
      for (const id of item.descendantIds) covered.add(id);
    }
  }

  const known = new Set<string>(flat.map((item) => item.id));
  return [...result, ...[...selected].filter((id) => !known.has(id))];
};

export const expandCategoryIds = ({
  categoryIds,
  categories,
}: {
  categoryIds: string[];
  categories: FormattedCategory[];
}): string[] => {
  const descendantsById = new Map<string, string[]>(
    flattenCategories({ categories }).map((item) => [item.id, item.descendantIds]),
  );
  return [...new Set(categoryIds.flatMap((id) => [id, ...(descendantsById.get(id) ?? [])]))];
};

/** Ancestors are taken too: selecting one would cover the other line's subtree. */
export const buildTakenCategories = ({
  lines,
  categories,
}: {
  lines: Pick<BudgetPlanLineEntry, 'name' | 'categoryIds'>[];
  categories: FormattedCategory[];
}): Record<string, string> => {
  const flat = flattenCategories({ categories });
  const takenBy: Record<string, string> = {};

  for (const line of lines) {
    const own = new Set(line.categoryIds);
    for (const item of flat) {
      if (own.has(item.id)) {
        for (const id of [item.id, ...item.descendantIds]) takenBy[id] = line.name;
      } else if (item.descendantIds.some((id) => own.has(id))) {
        takenBy[item.id] = line.name;
      }
    }
  }

  return takenBy;
};
