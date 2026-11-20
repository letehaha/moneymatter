import {
  getActiveJobsForUser,
  getJobGroupProgress,
} from '@services/bank-data-providers/monobank/transaction-sync-queue';
import { getUserAccountsSyncStatus } from '@services/bank-data-providers/sync/get-user-sync-status';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { presentBankSyncStatus } from './bank-connection-output';
import { assertNotDemoUser } from './helpers';

export const getBankSyncStatusTool = defineTool({
  name: 'get_bank_sync_status',
  toolset: 'imports',
  access: 'read',
  description:
    "Read the sync state of the bank-connected accounts: the last automatic sync, a summary (total, syncing, queued, completed, failed, idle), per account its status, startedAt, completedAt and error, the connections that need reconnecting (connectionsNeedingReauth) and the consent state of every connection (connectionStatuses). Also returns activeJobs, the syncs queued or running now ({ jobGroupId, connectionId, accountId, status }). Pass jobGroupId from activeJobs to get that sync's jobGroupProgress (batch counts, status, progress). Read-only: syncing and reconnecting a bank is done in the app. Not available to demo users.",
  input: {
    jobGroupId: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe('A job group id from activeJobs: also returns the progress of that sync'),
  },
  run: async ({ userId, args, extra }) => {
    // GET /bank-data-providers/sync/status carries blockDemoUsers.
    assertNotDemoUser({ extra });

    const [status, activeJobs, jobGroupProgress] = await Promise.all([
      getUserAccountsSyncStatus(userId),
      getActiveJobsForUser(userId),
      args.jobGroupId ? getJobGroupProgress({ jobGroupId: args.jobGroupId, userId }) : undefined,
    ]);

    return {
      status: presentBankSyncStatus({ status }),
      activeJobs: activeJobs.map((job) => ({
        jobGroupId: job.jobGroupId,
        connectionId: job.connectionId,
        accountId: job.accountId,
        status: job.status,
      })),
      ...(jobGroupProgress
        ? {
            jobGroupProgress: {
              totalBatches: jobGroupProgress.totalBatches,
              completedBatches: jobGroupProgress.completedBatches,
              failedBatches: jobGroupProgress.failedBatches,
              activeBatches: jobGroupProgress.activeBatches,
              waitingBatches: jobGroupProgress.waitingBatches,
              status: jobGroupProgress.status,
              progress: jobGroupProgress.progress,
            },
          }
        : {}),
    };
  },
});
