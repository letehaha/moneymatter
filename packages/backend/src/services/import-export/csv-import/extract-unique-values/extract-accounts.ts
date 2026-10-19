import { AccountOption, AccountOptionValue, SourceAccount } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

interface AccountExtractionResult {
  sourceAccounts: SourceAccount[];
}

export function extractAccounts(
  headers: string[],
  dataRows: string[][],
  accountOption: AccountOption,
  currencyColumnIndex: number,
  defaultCurrency: string | null,
): AccountExtractionResult {
  const result: AccountExtractionResult = {
    sourceAccounts: [],
  };

  if (accountOption.option === AccountOptionValue.dataSourceColumn) {
    const accountIndex = headers.indexOf(accountOption.columnName);
    if (accountIndex === -1) {
      throw new ValidationError({
        message: t({ key: 'csvImport.accountColumnNotFound', variables: { columnName: accountOption.columnName } }),
      });
    }

    const accountCurrencyMap = new Map<string, Set<string>>();

    dataRows.forEach((row) => {
      const accountName = row[accountIndex]?.trim();
      if (!accountName) return;

      // Get currency for this row
      let currency: string;
      if (currencyColumnIndex !== -1) {
        currency = row[currencyColumnIndex]?.trim().toUpperCase() || '';
      } else if (defaultCurrency) {
        currency = defaultCurrency;
      } else {
        currency = '';
      }

      if (!accountCurrencyMap.has(accountName)) {
        accountCurrencyMap.set(accountName, new Set());
      }
      accountCurrencyMap.get(accountName)!.add(currency);
    });

    for (const [accountName, currencies] of accountCurrencyMap.entries()) {
      if (currencies.size > 1) {
        throw new ValidationError({
          message: t({
            key: 'csvImport.accountMultipleCurrencies',
            variables: { accountName, currencies: Array.from(currencies).join(', ') },
          }),
        });
      }
    }

    // Build result with single currency per account
    result.sourceAccounts = Array.from(accountCurrencyMap.entries())
      .map(([name, currencies]) => ({
        name,
        currency: Array.from(currencies)[0] || '',
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name));
  } else if (accountOption.option === AccountOptionValue.existingAccount) {
    // No source accounts to extract - using single existing account
    result.sourceAccounts = [];
  }

  return result;
}
