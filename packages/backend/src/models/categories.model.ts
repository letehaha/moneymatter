import { CATEGORY_TYPES, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { ValidationError } from '@js/errors';
import { Op } from 'sequelize';
import { Table, Column, Model, ForeignKey, DataType, BelongsToMany } from 'sequelize-typescript';

import CategoryTags from './category-tags.model';
import MerchantCategoryCodes from './merchant-category-codes.model';
import Tags from './tags.model';
import UserMerchantCategoryCodes from './user-merchant-category-codes.model';
import Users from './users.model';

@Table({
  timestamps: false,
  tableName: 'Categories',
  freezeTableName: true,
})
export default class Categories extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @Column({ allowNull: false, type: DataType.STRING })
  name!: string;

  /**
   * Stable, locale-independent identifier for seeded default categories (kebab-case).
   * Null for user-created custom categories. Survives renames and locale changes — used
   * by stats/sharing features to merge equivalent categories across users. The canonical
   * set of values lives in `default-categories.ts`.
   */
  @Column({ allowNull: true, type: DataType.STRING(100) })
  key!: string | null;

  // Lucide-icons icon name
  @Column({ allowNull: true, type: DataType.STRING(50) })
  icon!: string | null;

  @Column({ allowNull: false, type: DataType.STRING })
  color!: string;

  @Column({
    allowNull: false,
    defaultValue: CATEGORY_TYPES.custom,
    type: DataType.ENUM({ values: Object.values(CATEGORY_TYPES) }),
  })
  type!: CATEGORY_TYPES;

  @Column({ allowNull: true, type: DataType.UUID })
  parentId!: RecordId | null;

  @ForeignKey(() => Users)
  @Column({ type: DataType.INTEGER })
  userId!: number;

  @Column({ allowNull: false, defaultValue: false, type: DataType.BOOLEAN })
  applyDefaultTagsOnAiCategorization!: boolean;

  @BelongsToMany(() => MerchantCategoryCodes, {
    as: 'merchantCodes',
    through: () => UserMerchantCategoryCodes,
  })
  categoryId!: number;

  @BelongsToMany(() => Tags, {
    through: () => CategoryTags,
    foreignKey: 'categoryId',
    otherKey: 'tagId',
    as: 'defaultTags',
  })
  defaultTags?: Tags[];
}

export const getCategories = async ({ userId }: { userId: number }) => {
  const categories = await Categories.findAll({
    where: { userId },
    raw: true,
  });

  return categories;
};

export const getAccessibleCategories = async ({
  userIds,
  categoryIds,
}: {
  userIds: number[];
  categoryIds: RecordId[];
}) => {
  const conditions: Record<string, unknown>[] = [];
  if (userIds.length) conditions.push({ userId: userIds });
  if (categoryIds.length) conditions.push({ id: categoryIds });
  if (conditions.length === 0) return [];

  const categories = await Categories.findAll({
    where: conditions.length === 1 ? conditions[0] : { [Op.or]: conditions },
    raw: true,
  });

  return categories;
};

export interface CreateCategoryPayload {
  userId: number;
  name?: string;
  icon?: string | null;
  color?: string;
  parentId?: string;
  type?: CATEGORY_TYPES;
  applyDefaultTagsOnAiCategorization?: boolean;
}

export const createCategory = async ({ parentId, color, userId, ...params }: CreateCategoryPayload) => {
  if (parentId) {
    const parent = await Categories.findOne({
      where: { id: parentId, userId },
    });

    if (!parent) {
      throw new ValidationError({
        message: "Category with such parentId doesn't exist.",
      });
    }

    if (!color) color = parent.get('color');
  }

  const category = await Categories.create({
    parentId,
    color,
    userId,
    ...params,
  });

  return category;
};

export interface EditCategoryPayload {
  userId: number;
  categoryId: string;
  name?: string;
  icon?: string | null;
  color?: string;
  parentId?: RecordId | null;
  applyDefaultTagsOnAiCategorization?: boolean;
}

export const editCategory = async ({ userId, categoryId, ...params }: EditCategoryPayload) => {
  const [, categories] = await Categories.update(params, {
    where: {
      id: categoryId,
      userId,
    },
    returning: true,
  });

  return categories;
};

export interface DeleteCategoryPayload {
  userId: number;
  categoryId: string;
}

export const deleteCategory = async ({ userId, categoryId }: DeleteCategoryPayload) => {
  return Categories.destroy({
    where: { userId, id: categoryId },
  });
};

export const bulkCreate = (
  { data },
  {
    validate = true,
    returning = false,
  }: {
    validate?: boolean;
    returning?: boolean;
  },
) => {
  return Categories.bulkCreate(data, {
    validate,
    returning,
  });
};
