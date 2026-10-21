import { parseImportDate } from '@bt/shared/import-export/date-engine';
import type { ColumnMappingConfig, InvalidRow, ParsedTransactionRow } from '@bt/shared/types';
import {
  AccountOptionValue,
  CategoryOptionValue,
  CurrencyOptionValue,
  TagOptionValue,
  TransactionTypeOptionValue,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import * as Accounts from '@models/accounts.model';
import { anchorImportDate } from '@services/import-export/core/parse/anchor-import-date';
import { parseAmount } from '@services/import-export/core/parse/parse-amount';
import { splitTagCell } from '@services/import-export/core/parse/split-tag-cell';

import { MAX_CSV_ROWS } from './csv-parser.service';
import { parseCsvRecords } from './parse-csv-records';

interface ParseValidRowsParams {
  userId: number;
  fileContent: string;
  delimiter: string;
  columnMapping: ColumnMappingConfig;
  /**
   * IANA timezone of the importing user's browser (e.g. `America/Montevideo`).
   * Anchors date-only and zone-less datetime cells to the correct calendar day.
   * Optional — absent/invalid values fall back to UTC anchoring.
   */
  timezone?: string;
}

interface ParseValidRowsResult {
  validRows: ParsedTransactionRow[];
  invalidRows: InvalidRow[];
}

/**
 * Parse a CSV `fileContent` against the user's `columnMapping` into validated
 * rows. Pure with respect to its inputs: the same fileContent + delimiter +
 * columnMapping + timezone always yields identical rows AND identical
 * `rowIndex` values. That determinism is what lets the async executor re-parse
 * server-side instead of round-tripping `validRows` through Redis — the skip
 * indices computed by the interactive detect-duplicates step stay valid against
 * a fresh re-parse.
 *
 * This is the shared front half of both the interactive detect-duplicates
 * endpoint and the background execute worker.
 */
export async function parseValidRows({
  userId,
  fileContent,
  delimiter,
  columnMapping,
  timezone,
}: ParseValidRowsParams): Promise<ParseValidRowsResult> {
  // Parse full CSV
  const records = parseCsvRecords({ fileContent, delimiter });

  if (records.length === 0) {
    throw new ValidationError({ message: t({ key: 'csvImport.csvFileEmpty' }) });
  }

  const headers = records[0]!;
  const dataRows = records.slice(1);

  if (dataRows.length > MAX_CSV_ROWS) {
    throw new ValidationError({
      message: t({ key: 'csvImport.csvFileTooManyRows', variables: { max: MAX_CSV_ROWS } }),
    });
  }

  // Get column indices
  const dateIndex = headers.indexOf(columnMapping.date);
  const amountIndex = headers.indexOf(columnMapping.amount);
  const descriptionIndex = columnMapping.description ? headers.indexOf(columnMapping.description) : -1;
  const payeeIndex = columnMapping.payee ? headers.indexOf(columnMapping.payee) : -1;
  // A typo'd / case-mismatched `payee` mapping previously fell through as -1
  // here and silently ran the entire import with no payee data — the row
  // never picked up `rawMerchantName`, payee_rule never fired, and the user
  // saw "imported" without ever learning their mapped column was unreachable.
  // Fail validation upfront so the UI can surface the bad column.
  if (columnMapping.payee && payeeIndex === -1) {
    throw new ValidationError({
      message: t({ key: 'csvImport.payeeColumnNotFound', variables: { column: columnMapping.payee } }),
    });
  }
  const categoryIndex = getCategoryColumnIndex(headers, columnMapping);
  const tagIndex = getTagColumnIndex(headers, columnMapping);
  const accountIndex = getAccountColumnIndex(headers, columnMapping);
  const currencyIndex = getCurrencyColumnIndex(headers, columnMapping);
  const transactionTypeIndex = getTransactionTypeColumnIndex(headers, columnMapping);

  // Get default values for single-selection options
  const defaultCurrency = await getDefaultCurrency(userId, columnMapping);

  // The day/month order of the ambiguous d/d/yyyy family is the user's explicit
  // wizard choice, applied to the whole column. Cells that don't form a valid
  // calendar date under that order fall into the per-row invalid path below —
  // never a whole-column block, and never a re-guess per value.
  const dateFormat = { fieldOrder: columnMapping.dateFieldOrder };

  // Parse and validate each row
  const validRows: ParsedTransactionRow[] = [];
  const invalidRows: InvalidRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]!;
    const rowIndex = i + 2; // +2 because row 1 is headers, and we're 1-indexed
    const errors: string[] = [];

    // Parse date through the engine (timezone-agnostic), then anchor it to a
    // stored instant against the importing user's timezone. `null` means the
    // value matched no known shape or is impossible under the confirmed
    // day/month order (e.g. `13/13/2026`) — a loud per-row invalid.
    const dateStr = row[dateIndex]?.trim() || '';
    const parsedDate = parseImportDate({ value: dateStr, format: dateFormat });
    if (!parsedDate) {
      errors.push(t({ key: 'csvImport.invalidDateFormat', variables: { dateStr } }));
    }

    // Parse amount
    const amountStr = row[amountIndex]?.trim() || '';
    const parsedAmount = parseAmount(amountStr);
    const amount = parsedAmount === null ? null : Money.fromDecimal(parsedAmount);
    if (amount === null) {
      errors.push(t({ key: 'csvImport.invalidAmount', variables: { amountStr } }));
    }

    // Get description
    const description = descriptionIndex !== -1 ? row[descriptionIndex]?.trim() || '' : '';

    // Get Payee name (if mapped). Stored unconditionally — extraction
    // (Step 1 exact / Step 2 fuzzy / Step 3 promotion) is the same code path
    // bank-sync providers exercise via `rawMerchantName`.
    const payeeName = payeeIndex !== -1 ? row[payeeIndex]?.trim() || undefined : undefined;

    // Get category name (if from column)
    const categoryName = categoryIndex !== -1 ? row[categoryIndex]?.trim() || undefined : undefined;

    // Get tag names (if a tag column is mapped). Comma-split, trimmed, blanks
    // dropped. Absent when no tag column was mapped so the row behaves exactly
    // as it did before tags existed.
    const tagNames = tagIndex !== -1 ? splitTagCell(row[tagIndex]) : undefined;

    // Get account name (if from column) or use default
    let accountName = '';
    if (accountIndex !== -1) {
      accountName = row[accountIndex]?.trim() || '';
      if (!accountName) {
        errors.push(t({ key: 'csvImport.accountNameEmpty' }));
      }
    }

    // Get currency (if from column) or use default
    let currencyCode = defaultCurrency;
    if (currencyIndex !== -1) {
      currencyCode = row[currencyIndex]?.trim().toUpperCase() || '';
      if (!currencyCode) {
        errors.push(t({ key: 'csvImport.currencyCodeEmpty' }));
      }
    }

    // Determine transaction type
    let transactionType: 'income' | 'expense' = 'expense';
    if (columnMapping.transactionType.option === TransactionTypeOptionValue.amountSign) {
      transactionType = amount !== null && !amount.isNegative() ? 'income' : 'expense';
    } else if (transactionTypeIndex !== -1) {
      const typeValue = row[transactionTypeIndex]?.trim() || '';
      const typeOption = columnMapping.transactionType;
      if (typeOption.option === TransactionTypeOptionValue.dataSourceColumn) {
        if (typeOption.incomeValues.includes(typeValue)) {
          transactionType = 'income';
        } else if (typeOption.expenseValues.includes(typeValue)) {
          transactionType = 'expense';
        } else {
          errors.push(t({ key: 'csvImport.unknownTransactionType', variables: { typeValue } }));
        }
      }
    }

    if (errors.length > 0) {
      invalidRows.push({
        rowIndex,
        errors,
        rawData: headers.reduce(
          (acc, header, idx) => {
            acc[header] = row[idx] || '';
            return acc;
          },
          {} as Record<string, string>,
        ),
      });
    } else {
      // `row.date` carries the resolved absolute instant as an ISO string, so
      // `execute-import`'s `new Date(row.date)` reconstructs the exact moment.
      const instant = anchorImportDate({ parsed: parsedDate!, timezone });
      validRows.push({
        rowIndex,
        date: instant.toISOString(),
        amount: amount!.abs().toNumber(), // Absolute decimal, sign determined by transactionType
        description,
        payeeName,
        categoryName,
        tagNames,
        accountName,
        currencyCode,
        transactionType,
      });
    }
  }

  return { validRows, invalidRows };
}

function getCategoryColumnIndex(headers: string[], columnMapping: ColumnMappingConfig): number {
  const categoryOption = columnMapping.category;
  if (
    categoryOption.option === CategoryOptionValue.mapDataSourceColumn ||
    categoryOption.option === CategoryOptionValue.createNewCategories
  ) {
    return headers.indexOf(categoryOption.columnName);
  }
  return -1;
}

function getTagColumnIndex(headers: string[], columnMapping: ColumnMappingConfig): number {
  const tagOption = columnMapping.tags;
  if (tagOption && tagOption.option === TagOptionValue.mapDataSourceColumn) {
    return headers.indexOf(tagOption.columnName);
  }
  return -1;
}

function getAccountColumnIndex(headers: string[], columnMapping: ColumnMappingConfig): number {
  const accountOption = columnMapping.account;
  if (accountOption.option === AccountOptionValue.dataSourceColumn) {
    return headers.indexOf(accountOption.columnName);
  }
  return -1;
}

function getCurrencyColumnIndex(headers: string[], columnMapping: ColumnMappingConfig): number {
  const currencyOption = columnMapping.currency;
  if (currencyOption.option === CurrencyOptionValue.dataSourceColumn) {
    return headers.indexOf(currencyOption.columnName);
  }
  return -1;
}

function getTransactionTypeColumnIndex(headers: string[], columnMapping: ColumnMappingConfig): number {
  const transactionTypeOption = columnMapping.transactionType;
  if (transactionTypeOption.option === TransactionTypeOptionValue.dataSourceColumn) {
    return headers.indexOf(transactionTypeOption.columnName);
  }
  return -1;
}

async function getDefaultCurrency(userId: number, columnMapping: ColumnMappingConfig): Promise<string> {
  const currencyOption = columnMapping.currency;
  if (currencyOption.option === CurrencyOptionValue.existingCurrency) {
    return currencyOption.currencyCode.toUpperCase();
  }

  // If using existing account, get currency from that account
  const accountOption = columnMapping.account;
  if (accountOption.option === AccountOptionValue.existingAccount) {
    const account = await Accounts.getAccountById({ userId, id: accountOption.accountId });
    if (account) {
      return account.currencyCode;
    }
  }

  return '';
}
