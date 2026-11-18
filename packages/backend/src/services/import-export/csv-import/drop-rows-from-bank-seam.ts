import type { AccountMappingConfig, ParsedTransactionRow } from '@bt/shared/types';
import * as Accounts from '@models/accounts.model';
import { getSeamStart } from '@services/accounts/seam';

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
  const seamStartByAccountName = new Map<string, Date>();
  const seamStartByAccountId = new Map<string, Date>();

  for (const accountName of new Set(rows.map((row) => row.accountName))) {
    const mapping = accountMapping[accountName];
    let accountId: string | undefined;
    if (mapping?.action === 'link-existing') accountId = mapping.accountId;
    else if (!mapping) accountId = defaultAccountId ?? undefined;
    if (!accountId) continue;

    const account = await Accounts.getAccountById({ userId, id: accountId });
    const seamStart = account && getSeamStart({ account });
    if (!seamStart) continue;

    seamStartByAccountName.set(accountName, seamStart);
    seamStartByAccountId.set(account.id, seamStart);
  }

  const kept = rows.filter((row) => {
    const seamStart = seamStartByAccountName.get(row.accountName);
    return !seamStart || new Date(row.date) < seamStart;
  });

  return { rows: kept, droppedCount: rows.length - kept.length, seamStartByAccountId };
}
