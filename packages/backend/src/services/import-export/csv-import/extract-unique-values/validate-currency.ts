import { AccountOptionValue, type ColumnMappingConfig, CurrencyOptionValue } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import * as Accounts from '@models/accounts.model';
import * as Currencies from '@models/currencies.model';

/**
 * Validate currency code format (3-letter uppercase)
 */
function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

interface CurrencyValidationResult {
  currencyColumnIndex: number;
  defaultCurrency: string | null;
  /** Warning message if user selected existing account with different currency than CSV data */
  currencyMismatchWarning?: string;
}

interface ValidateCurrencyParams {
  userId: number;
  headers: string[];
  dataRows: string[][];
  columnMapping: ColumnMappingConfig;
}

export async function validateCurrency({
  userId,
  headers,
  dataRows,
  columnMapping,
}: ValidateCurrencyParams): Promise<CurrencyValidationResult> {
  let currencyColumnIndex = -1;
  let defaultCurrency: string | null = null;
  let currencyMismatchWarning: string | undefined;
  const currencyOption = columnMapping.currency;

  if (currencyOption.option === CurrencyOptionValue.dataSourceColumn) {
    currencyColumnIndex = headers.indexOf(currencyOption.columnName);
    if (currencyColumnIndex === -1) {
      throw new ValidationError({
        message: t({ key: 'csvImport.currencyColumnNotFound', variables: { columnName: currencyOption.columnName } }),
      });
    }

    // Collect unique currencies and validate format
    const uniqueCurrencies = new Set<string>();
    const invalidCurrencies: string[] = [];

    dataRows.forEach((row, index) => {
      const currency = row[currencyColumnIndex]?.trim().toUpperCase();
      if (currency) {
        if (!isValidCurrencyCode(currency)) {
          invalidCurrencies.push(t({ key: 'csvImport.invalidCurrencyRow', variables: { row: index + 2, currency } }));
        } else {
          uniqueCurrencies.add(currency);
        }
      }
    });

    if (invalidCurrencies.length > 0) {
      const rows = invalidCurrencies.slice(0, 5);
      if (invalidCurrencies.length > 5) {
        rows.push(t({ key: 'csvImport.andMoreRows', variables: { count: invalidCurrencies.length - 5 } }));
      }
      throw new ValidationError({
        message: t({ key: 'csvImport.invalidCurrencyCodes', variables: { rows: rows.join('\n') } }),
      });
    }

    // Validate that all unique currencies exist in the system
    const currencyCodes = Array.from(uniqueCurrencies);
    if (currencyCodes.length > 0) {
      const existingCurrencies = await Currencies.getCurrencies({ codes: currencyCodes });
      const existingCodes = new Set(existingCurrencies.map((c) => c.code));
      const missingCurrencies = currencyCodes.filter((code) => !existingCodes.has(code));

      if (missingCurrencies.length > 0) {
        throw new ValidationError({
          message: t({ key: 'csvImport.unknownCurrencyCodes', variables: { codes: missingCurrencies.join(', ') } }),
        });
      }
    }

    // Check if user selected existing account - warn about currency mismatch
    if (columnMapping.account.option === AccountOptionValue.existingAccount) {
      const account = await Accounts.getAccountById({
        userId,
        id: columnMapping.account.accountId,
      });

      if (account && uniqueCurrencies.size > 0) {
        const csvCurrencies = Array.from(uniqueCurrencies);
        const mismatchedCurrencies = csvCurrencies.filter((c) => c !== account.currencyCode);

        if (mismatchedCurrencies.length > 0) {
          currencyMismatchWarning = t({
            key: 'csvImport.currencyMismatchWarning',
            variables: { currencies: mismatchedCurrencies.join(', '), accountCurrency: account.currencyCode },
          });
        }
      }
    }
  } else if (currencyOption.option === CurrencyOptionValue.existingCurrency) {
    defaultCurrency = currencyOption.currencyCode.toUpperCase();

    if (!isValidCurrencyCode(defaultCurrency)) {
      throw new ValidationError({
        message: t({ key: 'csvImport.invalidDefaultCurrency', variables: { defaultCurrency } }),
      });
    }

    // Validate that the currency exists in the system
    const currency = await Currencies.getCurrency({ code: defaultCurrency });
    if (!currency) {
      throw new ValidationError({
        message: t({ key: 'csvImport.currencyNotSupported', variables: { currency: defaultCurrency } }),
      });
    }
  }

  return { currencyColumnIndex, defaultCurrency, currencyMismatchWarning };
}
