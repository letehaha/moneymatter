import type { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import {
  countUnfinishedMonobankJobsForUser,
  refreshMonobankBundleDiscovery,
  removePendingJobsForUser,
} from '@services/bank-data-providers/monobank/transaction-sync-queue';
import { countUnfinishedAccountSyncJobsForUser } from '@services/bank-data-providers/sync/account-sync-queue';
import {
  SyncStatus,
  getMultipleAccountsSyncStatus,
  isActiveSync,
  setAccountSyncStatus,
} from '@services/bank-data-providers/sync/sync-status-tracker';
import { budgetBakersWalletImportQueue } from '@services/import-export/budget-bakers-wallet-import';
import { csvImportQueue } from '@services/import-export/csv-import/csv-import-queue';
import { msMoneyImportQueue } from '@services/import-export/ms-money-import';
import { ofxImportQueue } from '@services/import-export/ofx-import';
import { statementImportQueue } from '@services/import-export/statement-parser/statement-import-queue';
import { ynabImportQueue } from '@services/import-export/ynab-import';
import { Queue } from 'bullmq';

// Real drain windows in prod, compressed in tests so the e2e suites that enqueue a
// genuine job don't each pay the full grace/timeout. The 5s grace covers in-flight
// HTTP writes and cron iterations, which resolve FX from the DB and commit sub-second.
const IS_TEST = process.env.NODE_ENV === 'test';
const POLL_INTERVAL_MS = IS_TEST ? 250 : 2000;
const GRACE_MS = IS_TEST ? 100 : 5000;
const TIMEOUT_MS = IS_TEST ? 3000 : 5 * 60 * 1000;
const REDISCOVERY_RETRY_DELAY_MS = IS_TEST ? 100 : 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Typed as the base `Queue` so the importers' distinct generic data types
// collapse to one callable `getJobs` signature.
const importQueues: Queue[] = [
  csvImportQueue,
  ynabImportQueue,
  budgetBakersWalletImportQueue,
  msMoneyImportQueue,
  ofxImportQueue,
  statementImportQueue,
];

/** Import workers write transactions row-by-row; an active job for this user could
 *  commit rows against the old base. Count active jobs across every importer. */
async function countActiveImportJobsForUser({ userId }: { userId: number }): Promise<number> {
  const jobsPerQueue = await Promise.all(importQueues.map((queue) => queue.getJobs(['active'])));
  return jobsPerQueue.flat().filter((job) => (job.data as { userId?: number }).userId === userId).length;
}

/** The only visibility into the fire-and-forget direct-provider syncs: a bank
 *  account left QUEUED/SYNCING means one is still writing transactions. */
async function hasAccountMidSync({ userId }: { userId: number }): Promise<boolean> {
  const accounts = await Accounts.findAll({ where: { userId }, attributes: ['id'], raw: true });
  if (accounts.length === 0) return false;
  const statuses = await getMultipleAccountsSyncStatus(accounts.map((account) => account.id));
  return statuses.some(({ status }) => isActiveSync({ status }));
}

/**
 * Block until no in-flight writer can still commit an amount computed against the
 * old base currency, then wait a fixed grace. Called first thing in the worker,
 * before the recalc opens its DB transaction.
 *
 * Bulk-removes the user's not-yet-started monobank batches up front so the drain
 * doesn't wait one-per-60s for the rate limiter to release them, then polls every
 * few seconds for: monobank batches and account-sync jobs (active + waiting +
 * delayed), active import jobs, and any bank account left QUEUED/SYNCING. On
 * timeout it throws — nothing has been mutated and the worker's `finally` releases
 * the lock, so the user simply retries.
 */
export async function drainUserWriters({ userId }: { userId: number }): Promise<void> {
  // Fresh scan (bypassing the memoized boot recovery) so bundles created since
  // startup — including by another process — are discovered before we remove/count.
  // A cross-process monobank sync that stays undiscovered would keep writing old-base
  // rows invisibly to the drain, so a failed scan is retried once and then fails the
  // job — the worker's `finally` releases the lock and the user retries.
  try {
    await refreshMonobankBundleDiscovery();
  } catch (firstErr) {
    logger.warn(`[Base Currency Change Drain] Monobank bundle rediscovery failed, retrying: ${String(firstErr)}`);
    await sleep(REDISCOVERY_RETRY_DELAY_MS);
    try {
      await refreshMonobankBundleDiscovery();
    } catch (retryErr) {
      logger.error({
        message: '[Base Currency Change Drain] Monobank bundle rediscovery failed after retry',
        error: retryErr instanceof Error ? retryErr : new Error(String(retryErr)),
      });
      throw new Error(t({ key: 'currencies.baseCurrencyChangeDrainCheckFailed' }), { cause: retryErr });
    }
  }
  const { removedAccountIds } = await removePendingJobsForUser({ userId });
  // Accounts whose only work was the batches we just deleted. Their tracker
  // status is left QUEUED/SYNCING with no worker remaining to ever settle it,
  // which hasAccountMidSync would otherwise poll on until the drain times out.
  const orphanedAccountIds = new Set(removedAccountIds);

  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const [monobankPending, accountSyncPending, activeImports, midSync] = await Promise.all([
      countUnfinishedMonobankJobsForUser({ userId }),
      countUnfinishedAccountSyncJobsForUser({ userId }),
      countActiveImportJobsForUser({ userId }),
      hasAccountMidSync({ userId }),
    ]);

    // Once no unfinished monobank job remains, no worker will ever settle the
    // statuses of the accounts we removed jobs from — settle them ourselves.
    // Waiting for the pending count to hit zero first avoids racing a batch-0
    // SYNCING write. COMPLETED (not FAILED) mirrors the worker's lock-abort:
    // the skipped, deduped date range is re-fetched by the next auto-sync.
    if (monobankPending === 0 && orphanedAccountIds.size > 0) {
      const statuses = await getMultipleAccountsSyncStatus([...orphanedAccountIds] as RecordId[]);
      await Promise.all(
        statuses
          .filter(({ status }) => isActiveSync({ status }))
          .map((s) => setAccountSyncStatus({ accountId: s.accountId, status: SyncStatus.COMPLETED, userId })),
      );
      orphanedAccountIds.clear();
    }

    if (monobankPending === 0 && accountSyncPending === 0 && activeImports === 0 && !midSync) {
      // Fixed grace so in-flight HTTP writes / cron iterations that already passed
      // their lock check commit before the recalc snapshots rows.
      await sleep(GRACE_MS);
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(t({ key: 'currencies.baseCurrencyChangeSyncInProgress' }));
}
