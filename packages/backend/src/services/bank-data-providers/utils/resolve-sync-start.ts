import type Accounts from '@models/accounts.model';
import { subDays } from 'date-fns';

import { clampSyncStartToLink } from './clamp-sync-start-to-link';
import { findSyncAnchor } from './find-sync-anchor';

/**
 * Anchors an incremental sync at `findSyncAnchor`, clamped to the link date.
 * A future-dated row must not anchor: it pushes `from` past `to` and every sync becomes a no-op.
 * An account with no history backfills `backfillDays` instead, and a backfill must not consume plans.
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
  const anchor = await findSyncAnchor({ account, to });

  if (!anchor) return { anchor: null, from: subDays(to, backfillDays), matchPlanned: false };

  return { anchor, from: clampSyncStartToLink({ account, from: anchor }), matchPlanned: true };
}
