import { sweepInterruptedRuns } from '@services/chat/runs/sweep';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * Recovers runs whose process died. It runs every 2 minutes and once at boot, so a restart in the
 * middle of a run is recovered within about two minutes of the lease running out, whatever the run's age.
 */
export const chatRunSweepCron = createScheduledSync({
  name: 'chat run sweep',
  cronExpression: '*/2 * * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs every 2 minutes',
  errorCode: 'CHAT_RUN_SWEEP_CRON',
  run: sweepInterruptedRuns,
});
