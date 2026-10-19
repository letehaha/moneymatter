import type { CategoryMappingConfig } from '@bt/shared/types';
import { CATEGORY_TYPES } from '@bt/shared/types';
import { pickRandomColor } from '@common/lib/random-color';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import Categories from '@models/categories.model';
import { createCategory } from '@services/categories/create-category';
import { ImportJobError } from '@services/import-export/core/queue/import-job-error';
import { Op } from 'sequelize';

import { resolveOrCreateByName } from './resolve-or-create-by-name';

// Mirrors `Categories.name` varchar(255); checked up-front so a too-long
// source name fails with ValidationError instead of a raw Postgres reject.
const CATEGORY_NAME_MAX_LENGTH = 255;

interface CreateCategoriesIfNeededParams {
  userId: number;
  categoryMapping: CategoryMappingConfig;
}

interface CreateCategoriesIfNeededResult {
  /**
   * Resolved category id per distinct source category string. Many source
   * strings may resolve to the same id (many-to-one is intentional).
   */
  categoryNameToId: Map<string, string>;
  /** Number of categories actually inserted. Reused/linked categories don't count. */
  categoriesCreated: number;
}

/**
 * Resolve each distinct source category string in `categoryMapping` to a
 * category id, creating categories where the user chose `create-new`.
 *
 * - `link-existing`: verify the category id belongs to the user, then map to it.
 * - `create-new`: find-or-create by name, case-insensitively. When the user
 *   already owns a category with the same name (any casing) the source string
 *   links to that category instead of inserting a duplicate, and it isn't
 *   counted as created. Only a genuine insert increments `categoriesCreated`.
 */
export async function createCategoriesIfNeeded({
  userId,
  categoryMapping,
}: CreateCategoriesIfNeededParams): Promise<CreateCategoriesIfNeededResult> {
  for (const [sourceName, mapping] of Object.entries(categoryMapping)) {
    if (mapping.action !== 'create-new') continue;
    if (sourceName.length > CATEGORY_NAME_MAX_LENGTH) {
      const preview = `${sourceName.slice(0, 50)}…`;
      logger.info(`Tried to import too long category name: ${preview}`);
      const params = { name: preview, length: sourceName.length, max: CATEGORY_NAME_MAX_LENGTH };
      throw new ImportJobError({
        message: t({ key: 'importExport.categoryNameTooLong', variables: params }),
        failure: { code: 'category-name-too-long', params },
      });
    }
  }

  const { nameToId, created } = await resolveOrCreateByName({
    userId,
    mapping: Object.fromEntries(
      Object.entries(categoryMapping).map(([sourceName, mapping]) => [
        sourceName,
        mapping.action === 'link-existing'
          ? { action: 'link-existing' as const, id: mapping.categoryId }
          : { action: 'create-new' as const },
      ]),
    ),
    findOne: (args) => Categories.findOne(args),
    create: ({ userId: ownerId, name, color }) =>
      Categories.create({ userId: ownerId, name, color, type: CATEGORY_TYPES.custom }),
    notFoundMessage: (id) => t({ key: 'importExport.categoryIdNotFound', variables: { id } }),
  });

  return { categoryNameToId: nameToId, categoriesCreated: created };
}

interface TwoLevelCategoryInput {
  /** Parent (group) category name, e.g. YNAB's "Bills". */
  groupName: string;
  /** Leaf (child) category name under the group, e.g. YNAB's "Taxes". */
  categoryName: string;
  /** Stable key the caller uses to look the resolved leaf id back up. */
  fullName: string;
}

interface CreateTwoLevelCategoriesIfNeededParams {
  userId: number;
  categories: TwoLevelCategoryInput[];
}

interface CreateTwoLevelCategoriesIfNeededResult {
  /** Resolved leaf category id per input `fullName`. */
  categoryIdByFullName: Map<string, string>;
  /** Number of categories actually inserted (parents + leaves). Reused ones don't count. */
  categoriesCreated: number;
}

/**
 * Resolve a two-level (group → leaf) category list to a leaf id per `fullName`,
 * creating the parent group and the leaf under it where they don't already
 * exist. This is YNAB's shape ("Bills > Taxes" → parent "Bills" + child "Taxes"),
 * distinct from the flat single-level {@link createCategoriesIfNeeded} the CSV
 * and Wallet importers use.
 *
 * Existing same-named records on the user are reused rather than duplicated:
 * parents are matched among the user's top-level categories by exact name, and a
 * leaf is matched by exact name under its resolved parent. Lookups are batched
 * (one query for all parents, one for all children of the resolved parents) so a
 * large import doesn't issue a roundtrip per name. Only genuine inserts increment
 * `categoriesCreated`.
 *
 * Fail-fast: a failing `createCategory` propagates. No partial-success list.
 */
export async function createTwoLevelCategoriesIfNeeded({
  userId,
  categories,
}: CreateTwoLevelCategoriesIfNeededParams): Promise<CreateTwoLevelCategoriesIfNeededResult> {
  const categoryIdByFullName = new Map<string, string>();
  let categoriesCreated = 0;

  // Phase A: parent (group) categories. Reuse same-named top-level categories,
  // batching the existing-lookup so an import with dozens of groups doesn't
  // issue a roundtrip per name.
  const parentByGroupName = new Map<string, string>();
  const uniqueGroups = Array.from(new Set(categories.map((c) => c.groupName)));
  if (uniqueGroups.length > 0) {
    const existingParents = await Categories.findAll({
      where: { userId, parentId: null, name: { [Op.in]: uniqueGroups } },
    });
    for (const parent of existingParents) {
      parentByGroupName.set(parent.name, parent.id);
    }
  }
  for (const groupName of uniqueGroups) {
    if (parentByGroupName.has(groupName)) continue;
    const newParent = await createCategory({
      userId,
      name: groupName,
      color: pickRandomColor(),
      type: CATEGORY_TYPES.custom,
    });
    parentByGroupName.set(groupName, newParent.id);
    categoriesCreated += 1;
  }

  // Phase B: leaf (child) categories under their resolved parent. Reuse a child
  // matched by `${parentId}:${name}`, batching the existing-children lookup.
  const parentIds = Array.from(new Set(parentByGroupName.values()));
  const childIdByParentAndName = new Map<string, string>();
  if (parentIds.length > 0) {
    const existingChildren = await Categories.findAll({
      where: { userId, parentId: { [Op.in]: parentIds } },
    });
    for (const child of existingChildren) {
      childIdByParentAndName.set(`${child.parentId}:${child.name}`, child.id);
    }
  }
  for (const cat of categories) {
    const parentId = parentByGroupName.get(cat.groupName)!;
    const existingId = childIdByParentAndName.get(`${parentId}:${cat.categoryName}`);
    if (existingId) {
      categoryIdByFullName.set(cat.fullName, existingId);
    } else {
      const created = await createCategory({
        userId,
        name: cat.categoryName,
        parentId,
        type: CATEGORY_TYPES.custom,
      });
      categoryIdByFullName.set(cat.fullName, created.id);
      // Cache the insert so a second leaf with the same name under this parent
      // (a duplicated full-name in the input) reuses it.
      childIdByParentAndName.set(`${parentId}:${cat.categoryName}`, created.id);
      categoriesCreated += 1;
    }
  }

  return { categoryIdByFullName, categoriesCreated };
}
