import type { AccountMappingConfig, ParsedTransactionRow } from '@bt/shared/types';
import { isFromBankSeam, loadSeamStarts } from '@services/import-export/core/bank-seam';

/**
 * Rows mapped to an account with a bank seam and dated from the seam on belong to the
 * bank's own history, so they never reach duplicate detection or the import.
 */
export async function dropRowsFromBankSeam({
  userId,
  rows,
  accountMapping,
  defaultAccountId,
}: {
  userId: number;
  rows: ParsedTransactionRow[];
  accountMapping: AccountMappingConfig;
  defaultAccountId?: string | null;
}): Promise<{ rows: ParsedTransactionRow[]; droppedCount: number; seamStartByAccountId: Map<string, Date> }> {
  const accountIdByName = new Map<string, string>();
  for (const accountName of new Set(rows.map((row) => row.accountName))) {
    const mapping = accountMapping[accountName];
    let accountId: string | undefined;
    if (mapping?.action === 'link-existing') accountId = mapping.accountId;
    else if (!mapping) accountId = defaultAccountId ?? undefined;
    if (accountId) accountIdByName.set(accountName, accountId);
  }

  const { seamStartByName, seamStartByAccountId } = await loadSeamStarts({ userId, accountIdByName });

  const kept = rows.filter(
    (row) => !isFromBankSeam({ seamStart: seamStartByName.get(row.accountName), time: row.date }),
  );

  return { rows: kept, droppedCount: rows.length - kept.length, seamStartByAccountId };
}
