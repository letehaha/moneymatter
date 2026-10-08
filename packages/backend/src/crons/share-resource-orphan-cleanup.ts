import { cleanupOrphanShares } from '@services/sharing/cleanup/cleanup-orphan-shares.service';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * Daily safety-net sweep that removes `ResourceShares` and `ShareInvitations` whose
 * referenced resource (e.g. an `Accounts` row) no longer exists. The primary cleanup path
 * is `cleanupAccountSharesInTx` inside the account-delete service; this cron exists to
 * catch corner cases — direct DB deletes, future cascades that bypass the hook, or any
 * code path that drops shareable resources without going through the service layer.
 *
 * Schedule: 03:30 UTC daily. Staggered 15 minutes after the share-invitations expire
 * cron (03:15) so the two share-related sweeps don't compete for the same DB connections.
 */
export const shareResourceOrphanCleanupCron = createScheduledSync({
  name: 'share-resource orphan cleanup',
  cronExpression: '30 3 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 03:30 UTC',
  errorCode: 'SHARE_RESOURCE_ORPHAN_CLEANUP_CRON',
  run: cleanupOrphanShares,
});
