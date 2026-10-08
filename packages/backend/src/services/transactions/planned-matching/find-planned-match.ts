import { PLANNED_MATCH_WINDOW_DAYS, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { namespace } from '@models/connection';
import Transactions from '@models/transactions.model';
import { addDays, subDays } from 'date-fns';
import { Op, Sequelize } from 'sequelize';

/**
 * EXISTS probe against the partial `(accountId, time) WHERE isPlanned` index, so a sync or
 * import run can skip the matcher entirely instead of paying one candidate query per row.
 */
export const accountHasPlannedRows = async ({ accountId }: { accountId: string }): Promise<boolean> => {
  const row = await Transactions.findOne({
    where: { accountId, isPlanned: true },
    attributes: ['id'],
  });

  return row !== null;
};

/**
 * Probe a batch of accounts up front, so an import run pays one query per target account
 * instead of one per row.
 */
export const selectAccountsWithPlannedRows = async ({ accountIds }: { accountIds: string[] }): Promise<Set<string>> => {
  const accountsWithPlannedRows = new Set<string>();

  for (const accountId of accountIds) {
    if (await accountHasPlannedRows({ accountId })) accountsWithPlannedRows.add(accountId);
  }

  return accountsWithPlannedRows;
};

/**
 * Locate the planned row an incoming bank/import transaction confirms, and lock it for the
 * caller's merge. Filtering by `accountId` alone is enough: every planned row on an account
 * belongs to the account owner.
 *
 * `SKIP LOCKED` means a plan another in-flight batch already claimed reads as "no match", so
 * two copies of the same charge can never consume one plan.
 */
export const findPlannedMatch = async ({
  accountId,
  amount,
  transactionType,
  currencyCode,
  time,
}: {
  accountId: string;
  amount: Money;
  transactionType: TRANSACTION_TYPES;
  currencyCode: string;
  time: Date;
}): Promise<Transactions | null> => {
  if (!amount.isPositive()) return null;

  const sequelizeTx = namespace.get('transaction');

  return Transactions.findOne({
    where: {
      accountId,
      isPlanned: true,
      transactionType,
      currencyCode,
      transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
      amount: amount.toCents(),
      time: {
        [Op.between]: [subDays(time, PLANNED_MATCH_WINDOW_DAYS), addDays(time, PLANNED_MATCH_WINDOW_DAYS)],
      },
    },
    order: Sequelize.literal(
      `ABS(EXTRACT(EPOCH FROM ("time" - '${time.toISOString()}'::timestamptz))) ASC, "createdAt" ASC`,
    ),
    transaction: sequelizeTx,
    lock: sequelizeTx?.LOCK.UPDATE,
    skipLocked: Boolean(sequelizeTx),
  });
};
