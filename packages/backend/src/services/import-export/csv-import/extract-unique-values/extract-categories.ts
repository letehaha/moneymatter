import { CategoryOptionValue, type ColumnMappingConfig } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

/**
 * Extract categories if needed for map-data-source-column or create-new-categories
 * Both options need the unique category values from the CSV
 */
export function extractCategories({
  headers,
  dataRows,
  columnMapping,
}: {
  headers: string[];
  dataRows: string[][];
  columnMapping: ColumnMappingConfig;
}): string[] {
  const categoryOption = columnMapping.category;
  // Both map-data-source-column and create-new-categories need to extract unique values
  if (
    categoryOption.option === CategoryOptionValue.mapDataSourceColumn ||
    categoryOption.option === CategoryOptionValue.createNewCategories
  ) {
    const categoryIndex = headers.indexOf(categoryOption.columnName);
    if (categoryIndex === -1) {
      throw new ValidationError({
        message: t({ key: 'csvImport.categoryColumnNotFound', variables: { columnName: categoryOption.columnName } }),
      });
    }

    const uniqueCategories = new Set<string>();
    dataRows.forEach((row) => {
      const category = row[categoryIndex]?.trim();
      if (category) uniqueCategories.add(category);
    });

    return Array.from(uniqueCategories).toSorted();
  }

  // existing-category option doesn't need extraction
  return [];
}
