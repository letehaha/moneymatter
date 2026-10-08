import { RecordId } from '@bt/shared/types';
import Categories from '@models/categories.model';
import CategoryTags from '@models/category-tags.model';
import Tags from '@models/tags.model';
import { addTagsToTransactions } from '@services/tags/add-tags-to-transactions';

/**
 * Stamps `defaultTagIds` onto plain category rows. Only the caller's own categories get
 * their rule; categories visible through sharing get `[]` so another owner's tag ids never
 * reach a form that cannot use them.
 */
export async function attachDefaultTagIds<T extends { id: RecordId; userId: number }>({
  userId,
  categories,
}: {
  userId: number;
  categories: T[];
}): Promise<(T & { defaultTagIds: RecordId[] })[]> {
  const ownIds = categories.filter((category) => category.userId === userId).map((category) => category.id);
  const rows = ownIds.length ? await CategoryTags.findAll({ where: { categoryId: ownIds }, raw: true }) : [];
  const byCategory = new Map<RecordId, RecordId[]>();
  for (const row of rows) {
    const list = byCategory.get(row.categoryId) ?? [];
    list.push(row.tagId);
    byCategory.set(row.categoryId, list);
  }
  return categories.map((category) => ({ ...category, defaultTagIds: byCategory.get(category.id) ?? [] }));
}

/**
 * The one server-side apply of category default tags: rows the AI just categorized get
 * the tags of categories that opted in. Add-only merge via `addTagsToTransactions`.
 */
export async function applyCategoryDefaultTagsOnAiCategorization({
  userId,
  assignments,
}: {
  userId: number;
  assignments: { categoryId: string; transactionIds: string[] }[];
}): Promise<void> {
  const candidateIds = assignments.filter((a) => a.transactionIds.length).map((a) => a.categoryId);
  if (candidateIds.length === 0) return;

  const optedIn = await Categories.findAll({
    where: { id: candidateIds, userId, applyDefaultTagsOnAiCategorization: true },
    attributes: ['id'],
    include: [{ model: Tags, as: 'defaultTags', attributes: ['id'], through: { attributes: [] } }],
  });

  for (const category of optedIn) {
    const tagIds = (category.defaultTags ?? []).map((tag) => tag.id);
    const transactionIds = assignments.find((a) => a.categoryId === category.id)?.transactionIds ?? [];
    await addTagsToTransactions({ userId, tagIds, transactionIds });
  }
}
