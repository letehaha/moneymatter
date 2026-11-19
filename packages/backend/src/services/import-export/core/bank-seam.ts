import { ACCOUNT_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import * as Accounts from '@models/accounts.model';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { getSeamStart, isBeforeSeamStart } from '@services/accounts/seam';
import { withTransaction } from '@services/common/with-transaction';
import { ImportJobError } from '@services/import-export/core/queue/import-job-error';

/**
 * Seam start per source account name, for names resolved to an existing account with a
 * bank seam. Rows of those names dated from the seam on belong to the bank's history.
 */
export async function loadSeamStarts({
  userId,
  accountIdByName,
}: {
  userId: number;
  accountIdByName: Map<string, string>;
}): Promise<{ seamStartByName: Map<string, Date>; seamStartByAccountId: Map<string, Date> }> {
  const seamStartByAccountId = new Map<string, Date>();
  for (const accountId of new Set(accountIdByName.values())) {
    const account = await Accounts.getAccountById({ userId, id: accountId });
    const seamStart = account && getSeamStart({ account });
    if (seamStart) seamStartByAccountId.set(accountId, seamStart);
  }

  const seamStartByName = new Map<string, Date>();
  for (const [accountName, accountId] of accountIdByName) {
    const seamStart = seamStartByAccountId.get(accountId);
    if (seamStart) seamStartByName.set(accountName, seamStart);
  }

  return { seamStartByName, seamStartByAccountId };
}

export const linkedAccountIdByName = ({
  accountMapping,
}: {
  accountMapping: Record<string, { action: 'link-existing'; accountId: string } | { action: 'create-new' | 'skip' }>;
}): Map<string, string> =>
  new Map(
    Object.entries(accountMapping).flatMap(([accountName, mapping]) =>
      mapping.action === 'link-existing' ? [[accountName, mapping.accountId] as const] : [],
    ),
  );

export const excludeSeamAccounts = ({
  accountIds,
  seamStartByAccountId,
}: {
  accountIds: string[];
  seamStartByAccountId: Map<string, Date>;
}): string[] => accountIds.filter((accountId) => !seamStartByAccountId.has(accountId));

export const isFromBankSeam = ({
  seamStart,
  time,
}: {
  seamStart: Date | null | undefined;
  time: Date | string;
}): boolean => !!seamStart && !isBeforeSeamStart({ seamStart, time });

/** A transfer with either leg on a seam account dated from that seam on is dropped whole, counting each leg. */
export function dropFromBankSeam<
  Row extends { accountName: string; date: string },
  Transfer extends { sourceAccountName: string; destinationAccountName: string; date: string; rowIndices: number[] },
>({
  seamStartByName,
  rows,
  transfers,
}: {
  seamStartByName: Map<string, Date>;
  rows: Row[];
  transfers: Transfer[];
}): { rows: Row[]; transfers: Transfer[]; droppedCount: number } {
  const isDropped = ({ accountName, date }: { accountName: string; date: string }) =>
    isFromBankSeam({ seamStart: seamStartByName.get(accountName), time: date });

  const keptRows = rows.filter((row) => !isDropped(row));
  const droppedTransfers = new Set(
    transfers.filter((xfer) =>
      [xfer.sourceAccountName, xfer.destinationAccountName].some((accountName) =>
        isDropped({ accountName, date: xfer.date }),
      ),
    ),
  );

  return {
    rows: keptRows,
    transfers: transfers.filter((xfer) => !droppedTransfers.has(xfer)),
    droppedCount:
      rows.length - keptRows.length + [...droppedTransfers].reduce((count, xfer) => count + xfer.rowIndices.length, 0),
  };
}

export const bankLinkChangedError = () =>
  new ImportJobError({
    message: t({ key: 'csvImport.bankLinkChangedSinceReview' }),
    failure: { code: 'bank-link-changed' },
  });

/**
 * Runs once the batch row is committed: a link or unlink holding the account lock commits
 * first and is seen here, or reaches its unfinished-import check afterwards and is refused.
 */
export const assertBankLinksUnchanged = withTransaction(
  async ({
    userId,
    accountIds,
    seamStartByAccountId,
  }: {
    userId: number;
    accountIds: string[];
    seamStartByAccountId: Map<string, Date>;
  }): Promise<void> => {
    for (const accountId of accountIds.toSorted((a, b) => a.localeCompare(b))) {
      const account = await lockAccountRow({ accountId, userId, noKey: true });
      if (!account) continue;
      const seamStart = getSeamStart({ account });
      const isUnchanged = seamStart?.getTime() === seamStartByAccountId.get(accountId)?.getTime();
      if (!isUnchanged || (!seamStart && account.type !== ACCOUNT_TYPES.system)) throw bankLinkChangedError();
    }
  },
);
