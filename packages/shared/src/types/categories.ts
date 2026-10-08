import type { RecordId } from './record-id';

export enum CATEGORY_TYPES {
  custom = 'custom',
  // internal means that it cannot be deleted or edited
  internal = 'internal',
}

export interface EmbeddedCategoryModel {
  color: string;
  id: RecordId;
  icon: null | string;
  /**
   * Stable, locale-independent identifier for seeded default categories (kebab-case).
   * Null for user-created categories.
   */
  key: null | string;
  name: string;
  parentId: RecordId | null;
  type: CATEGORY_TYPES;
  userId: number;
  /** Opt-in: AI categorization also adds the category's default tags to the rows it assigns this category. */
  applyDefaultTagsOnAiCategorization: boolean;
}

/** A category as the categories endpoints return it; the embedded form carries no tag rule. */
export interface CategoryModel extends EmbeddedCategoryModel {
  /** Tags the transaction form pre-selects when this category is picked. */
  defaultTagIds: RecordId[];
}

export type CreateCategoryBody = {
  name: CategoryModel['name'];
  color?: CategoryModel['color'];
  icon?: CategoryModel['icon'];
  parentId?: CategoryModel['parentId'];
  defaultTagIds?: string[];
  applyDefaultTagsOnAiCategorization?: boolean;
};
export type CreateCategoryResponse = CategoryModel;

export type EditCategoryBody = Partial<
  Pick<CategoryModel, 'name' | 'color' | 'icon' | 'parentId' | 'applyDefaultTagsOnAiCategorization'>
> & {
  defaultTagIds?: string[];
};
export type EditCategoryResponse = CategoryModel[];

/** Maximum category tree depth, enforced on every write that assigns a parent. */
export const MAX_CATEGORIES_NESTING = 3;
