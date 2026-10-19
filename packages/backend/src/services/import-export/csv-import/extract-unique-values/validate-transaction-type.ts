import { type ColumnMappingConfig, TransactionTypeOptionValue } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

export function validateTransactionType({
  headers,
  dataRows,
  columnMapping,
}: {
  headers: string[];
  dataRows: string[][];
  columnMapping: ColumnMappingConfig;
}): void {
  const transactionTypeOption = columnMapping.transactionType;

  if (transactionTypeOption.option === TransactionTypeOptionValue.dataSourceColumn) {
    const typeIndex = headers.indexOf(transactionTypeOption.columnName);
    if (typeIndex === -1) {
      throw new ValidationError({
        message: t({
          key: 'csvImport.transactionTypeColumnNotFound',
          variables: { columnName: transactionTypeOption.columnName },
        }),
      });
    }

    // Collect unique type values
    const uniqueTypes = new Set<string>();
    dataRows.forEach((row) => {
      const type = row[typeIndex]?.trim();
      if (type) uniqueTypes.add(type);
    });

    const typesArray = Array.from(uniqueTypes);
    const { incomeValues, expenseValues } = transactionTypeOption;

    // Validate all values are covered
    const allCovered = typesArray.every((type) => incomeValues.includes(type) || expenseValues.includes(type));

    if (!allCovered) {
      const uncovered = typesArray.filter((type) => !incomeValues.includes(type) && !expenseValues.includes(type));
      throw new ValidationError({
        message: t({
          key: 'csvImport.transactionTypeValuesNotCovered',
          variables: { uncovered: uncovered.join(', '), found: typesArray.join(', ') },
        }),
      });
    }
  }
}
