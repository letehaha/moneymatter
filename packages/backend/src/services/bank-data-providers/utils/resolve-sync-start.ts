import type Accounts from '@models/accounts.model';
import { findOneTransaction } from '@models/transactions-query';
import { subDays } from 'date-fns';
import { Op } from 'sequelize';

import { clampSyncStartToLink } from './clamp-sync-start-to-link';

/**
 * Anchors an incremental sync at the newest stored row at or before `to`, clamped to the link date.
 * A future-dated row must not anchor: it pushes `from` past `to` and every sync becomes a no-op.
 * An account with no rows backfills `backfillDays` instead, and a backfill must not consume plans.
 */
export async function resolveSyncStart({
  account,
  to,
  backfillDays,
}: {
  account: Accounts;
  to: Date;
  backfillDays: number;
}): Promise<{ anchor: Date | null; from: Date; matchPlanned: boolean }> {
  const latest = await findOneTransaction({
    planned: 'exclude',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    where: { accountId: account.id, time: { [Op.lte]: to } },
    order: [['time', 'DESC']],
  });

  if (!latest) return { anchor: null, from: subDays(to, backfillDays), matchPlanned: false };

  const anchor = new Date(latest.time);
  return { anchor, from: clampSyncStartToLink({ account, from: anchor }), matchPlanned: true };
}
