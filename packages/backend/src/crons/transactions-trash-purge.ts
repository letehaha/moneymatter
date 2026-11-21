import { TRANSACTION_TRASH_RETENTION_DAYS } from '@bt/shared/types';
import { findTransactions } from '@models/transactions-query';
import { trashedWhere } from '@models/transactions-query/deletion-where';
import { withTransaction } from '@services/common/with-transaction';
import { destroyTrashedRows } from '@services/transactions/trash/delete-trashed';
import { subDays } from 'date-fns';
import { Op } from 'sequelize';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * The rows are locked before the delete, so a concurrent restore either finishes first (and the
 * row drops out of the selection) or waits. Both legs of a transfer are trashed together, so
 * they expire together.
 */
const purgeExpiredTrash = withTransaction(async (): Promise<{ purged: number }> => {
  const expired = await findTransactions({
    where: { ...trashedWhere, deletedAt: { [Op.lt]: subDays(new Date(), TRANSACTION_TRASH_RETENTION_DAYS) } },
    attributes: ['id'],
    paranoid: false,
    planned: 'include',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    completeness: 'all',
    lock: true,
  });
  const transactionIds = expired.map((row) => row.id);

  await destroyTrashedRows({ transactionIds });

  return { purged: transactionIds.length };
});

/** Schedule: 04:30 UTC daily, staggered after the other retention sweeps. */
export const transactionsTrashPurgeCron = createScheduledSync({
  name: 'purge of trashed transactions',
  cronExpression: '30 4 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 04:30 UTC',
  errorCode: 'TRANSACTIONS_TRASH_PURGE_CRON',
  run: purgeExpiredTrash,
});
