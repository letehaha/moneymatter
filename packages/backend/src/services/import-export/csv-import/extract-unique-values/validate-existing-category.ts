import { CategoryOptionValue, type ColumnMappingConfig } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Categories from '@models/categories.model';

interface ValidateExistingCategoryParams {
  userId: number;
  columnMapping: ColumnMappingConfig;
}

/**
 * Validates that the selected existing category belongs to the user
 */
export async function validateExistingCategory({
  userId,
  columnMapping,
}: ValidateExistingCategoryParams): Promise<void> {
  const categoryOption = columnMapping.category;

  if (categoryOption.option === CategoryOptionValue.existingCategory) {
    await findOrThrowNotFound({
      query: Categories.findOne({
        where: {
          id: categoryOption.categoryId,
          userId,
        },
      }),
      message: t({ key: 'csvImport.selectedCategoryNotFound' }),
    });
  }
}
