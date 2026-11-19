import type {
  AccountMappingConfig,
  CategoryMappingConfig,
  ColumnMappingConfig,
  DetectDuplicatesResponse,
  ParsedTransactionRow,
} from '@bt/shared/types';
import { AccountOptionValue } from '@bt/shared/types';
import * as Accounts from '@models/accounts.model';
import { findDuplicates } from '@services/import-export/core/duplicates/find-duplicates';
import { findUnpriceableRows } from '@services/import-export/core/duplicates/find-unpriceable-rows';

import { dropRowsFromBankSeam } from '../drop-rows-from-bank-seam';
import { parseValidRows } from '../parse-valid-rows';

interface DetectDuplicatesParams {
  userId: number;
  fileContent: string;
  delimiter: string;
  columnMapping: ColumnMappingConfig;
  accountMapping: AccountMappingConfig;
  categoryMapping: CategoryMappingConfig;
  /**
   * IANA timezone of the importing user's browser (e.g. `America/Montevideo`).
   * Anchors date-only and zone-less datetime cells to the correct calendar day.
   * Optional — absent/invalid values fall back to UTC anchoring.
   */
  timezone?: string;
}

/**
 * Parses all rows from the CSV (shared `parseValidRows`), then detects
 * duplicates against the user's existing transactions.
 */
export async function detectDuplicates({
  userId,
  fileContent,
  delimiter,
  columnMapping,
  accountMapping,
  timezone,
}: DetectDuplicatesParams): Promise<DetectDuplicatesResponse> {
  const { validRows: parsedRows, invalidRows } = await parseValidRows({
    userId,
    fileContent,
    delimiter,
    columnMapping,
    timezone,
  });

  const defaultAccountId = await getDefaultAccountId(userId, columnMapping);

  const { rows: validRows, droppedCount: skippedAfterBankSeam } = await dropRowsFromBankSeam({
    userId,
    rows: parsedRows,
    accountMapping,
    defaultAccountId,
  });

  // Build account name to ID mapping for duplicate detection
  const accountNameToId = await buildAccountNameToIdMapping(userId, validRows, accountMapping, defaultAccountId);

  // Find duplicates
  const duplicates = await findDuplicates({
    userId,
    validRows,
    accountNameToId,
  });

  // Identify rows whose currency has no stored exchange rate. The result is
  // passed to the preview so the user can decide to skip or abort those rows.
  // Rows on a skipped account never reach the import, so they must not gate the
  // preview on a missing rate.
  const skippedAccountNames = new Set(
    Object.entries(accountMapping)
      .filter(([, mapping]) => mapping.action === 'skip')
      .map(([accountName]) => accountName),
  );
  const unpriceableRows = await findUnpriceableRows({
    userId,
    validRows: validRows.filter((row) => !skippedAccountNames.has(row.accountName)),
  });

  return {
    validRows,
    invalidRows,
    duplicates,
    skippedAfterBankSeam,
    ...(unpriceableRows.length > 0 && { unpriceableRows }),
  };
}

async function getDefaultAccountId(userId: number, columnMapping: ColumnMappingConfig): Promise<string | null> {
  const accountOption = columnMapping.account;
  if (accountOption.option === AccountOptionValue.existingAccount) {
    const account = await Accounts.getAccountById({ userId, id: accountOption.accountId });
    return account?.id || null;
  }
  return null;
}

async function buildAccountNameToIdMapping(
  userId: number,
  validRows: ParsedTransactionRow[],
  accountMapping: AccountMappingConfig,
  defaultAccountId: string | null,
): Promise<Map<string, string | null>> {
  const mapping = new Map<string, string | null>();

  // If using single existing account, all rows map to that account
  if (defaultAccountId !== null) {
    const uniqueAccountNames = new Set(validRows.map((r) => r.accountName));
    for (const name of uniqueAccountNames) {
      mapping.set(name, defaultAccountId);
    }
    return mapping;
  }

  // Otherwise, use the account mapping from user
  for (const [accountName, mappingValue] of Object.entries(accountMapping)) {
    if (mappingValue.action === 'link-existing') {
      // Verify the account exists and belongs to user
      const account = await Accounts.getAccountById({ userId, id: mappingValue.accountId });
      mapping.set(accountName, account?.id || null);
    } else {
      // create-new: account doesn't exist yet, will be created during import
      mapping.set(accountName, null);
    }
  }

  return mapping;
}
