import { type ACCOUNT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import type Accounts from '@models/accounts.model';
import { findOneTransaction } from '@models/transactions-query';
import { getUserDefaultCategory } from '@models/users.model';
import { createTransaction } from '@services/transactions';
import { accountHasPlannedRows } from '@services/transactions/planned-matching';
import { Sequelize } from 'sequelize';

import type { SyncedTransactionRow } from '../types';
import { notifyPlannedConfirmations } from './notify-planned-confirmations';

/**
 * Persists rows in the given order, so callers must pass them oldest first. `matchPlanned`
 * is false for a backfill (must not consume plans) and is further gated on the account
 * having planned rows, probed once per call. Rows before `createFromDate` are deduped, never created.
 */
export const persistSyncedTransactions = async ({
  account,
  userId,
  accountType,
  rows,
  matchPlanned,
  createFromDate,
  checkpoint,
}: {
  account: Accounts;
  userId: number;
  accountType: ACCOUNT_TYPES;
  rows: SyncedTransactionRow[];
  matchPlanned: boolean;
  createFromDate?: Date;
  checkpoint: () => Promise<void>;
}): Promise<{ createdTransactionIds: string[]; mergedIntoPlannedCount: number; skippedPreLinkCount: number }> => {
  const defaultCategoryId = await getUserDefaultCategory({ id: userId });
  const createdTransactionIds: string[] = [];
  let mergedIntoPlannedCount = 0;
  let skippedPreLinkCount = 0;
  const canMatchPlanned = matchPlanned && (await accountHasPlannedRows({ accountId: account.id }));

  // Lookups stay per row: a provider may repeat an originalId within one batch,
  // and the repeat is dropped only because it sees the row just created.
  for (const row of rows) {
    await checkpoint();

    const existingTx = await findOneTransaction({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      where: { accountId: account.id, originalId: row.originalId },
      paranoid: false,
    });

    if (existingTx) {
      continue;
    }

    // Unlink clears `originalId` but keeps it under `externalData.originalSource`;
    // restoring it puts a relinked row back on the lookup above.
    const existingByOriginalSource = await findOneTransaction({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      where: Sequelize.and(
        { accountId: account.id, originalId: null },
        Sequelize.where(Sequelize.literal(`"externalData"#>>'{originalSource,originalId}'`), row.originalId),
      ),
      paranoid: false,
    });

    if (existingByOriginalSource) {
      await existingByOriginalSource.update({ originalId: row.originalId });
      continue;
    }

    // Never create rows before the link date: that history is already absorbed into the opening balance.
    if (createFromDate && row.time < createFromDate) {
      skippedPreLinkCount += 1;
      continue;
    }

    const signedAmount = Money.fromDecimal(row.amount);

    const createResult = await createTransaction({
      originalId: row.originalId,
      note: row.note,
      externalReference: row.externalReference,
      amount: signedAmount.abs(),
      time: row.time,
      externalData: row.externalData,
      commissionRate: Money.fromCents(0),
      cashbackAmount: Money.fromCents(0),
      accountId: account.id,
      userId,
      transactionType: signedAmount.toNumber() < 0 ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
      categoryId: defaultCategoryId,
      transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
      accountType,
      rawMerchantName: row.rawMerchantName,
      matchPlanned: canMatchPlanned,
    });

    // A merged row is not a new row: it keeps the user's category and payee, which the
    // post-sync listeners on the emitted ids would overwrite.
    if (createResult.mergedIntoPlanned) {
      mergedIntoPlannedCount += 1;
    } else {
      createdTransactionIds.push(createResult[0].id);
    }
  }

  await notifyPlannedConfirmations({ userId, accountId: account.id, mergedCount: mergedIntoPlannedCount });

  return { createdTransactionIds, mergedIntoPlannedCount, skippedPreLinkCount };
};
