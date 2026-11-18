import type Accounts from '@models/accounts.model';
import { findOneTransaction } from '@models/transactions-query';
import { getSeamStart } from '@services/accounts/seam';
import { Op } from 'sequelize';

/**
 * Where an incremental sync resumes: the newest live row at or before `to`, else the newest
 * trashed one, else the seam start. Null only for an account with no history at all, which
 * backfills. The trashed fallback covers a relinked account whose seam is not stamped yet.
 */
export const findSyncAnchor = async ({ account, to }: { account: Accounts; to: Date }): Promise<Date | null> => {
  const query: Parameters<typeof findOneTransaction>[0] = {
    planned: 'exclude',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    where: { accountId: account.id, time: { [Op.lte]: to } },
    order: [['time', 'DESC']],
  };
  const latest = (await findOneTransaction(query)) ?? (await findOneTransaction({ ...query, paranoid: false }));

  return latest ? new Date(latest.time) : getSeamStart({ account });
};
