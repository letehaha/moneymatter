import { expireOverdueInvitations } from '@services/sharing/invitations/expire-invitations.service';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * Daily sweep that flips `pending` ShareInvitations rows past their `expiresAt` to
 * `expired` and emits a `share_expired` notification to each owner.
 *
 * Schedule: 03:15 UTC daily. Avoids the on-the-hour spike that hits Resend / DB at the
 * top of every hour with the other crons.
 */
export const shareInvitationsExpireCron = createScheduledSync({
  name: 'share-invitations expire sweep',
  cronExpression: '15 3 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 03:15 UTC',
  errorCode: 'SHARE_INVITATIONS_EXPIRE_CRON',
  run: expireOverdueInvitations,
});
