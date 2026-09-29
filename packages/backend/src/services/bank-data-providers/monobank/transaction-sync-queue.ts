import {
  ACCOUNT_TYPES,
  CATEGORIZATION_SOURCE,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import type { RecordId } from '@bt/shared/types';
import { ExternalMonobankTransactionResponse } from '@bt/shared/types/external-services';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import { SentryTraceData, withQueueProcessSpan, withQueuePublishSpan } from '@js/utils/sentry';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import * as MerchantCategoryCodes from '@models/merchant-category-codes.model';
import { findOneTransaction } from '@models/transactions-query';
import * as UserMerchantCategoryCodes from '@models/user-merchant-category-codes.model';
import * as Users from '@models/users.model';
import { redisClient } from '@root/redis-client';
import { runPendingLinkAbsorb } from '@services/accounts/absorb-link-residual';
import { runWithBalanceRevalueBatch } from '@services/balances/revalue-balance-history.service';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import * as transactionsService from '@services/transactions';
import { accountHasPlannedRows } from '@services/transactions/planned-matching';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import crypto from 'crypto';
import IORedis from 'ioredis';

import { SyncStatus, setAccountSyncStatus } from '../sync/sync-status-tracker';
import { linkAndEmitSyncedTransactions } from '../utils/link-and-emit-synced-transactions';
import { notifyPlannedConfirmations } from '../utils/notify-planned-confirmations';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { MonobankAccountNotFoundError, MonobankApiClient, MonobankGeoBlockedError } from './api-client';

interface TransactionSyncJobData extends SentryTraceData {
  userId: number;
  accountId: RecordId;
  connectionId: string;
  externalAccountId: string;
  apiToken: string;
  fromTimestamp: number;
  toTimestamp: number;
  batchIndex: number;
  totalBatches: number;
  /** Only the incremental sync opts in; a historical period load must never consume a plan. */
  matchPlanned?: boolean;
}

// Redis connection configuration for BullMQ
// Uses same resilient settings as main redisClient to prevent "Connection is closed" errors in CI
const connection = {
  host: process.env.APPLICATION_REDIS_HOST,
  maxRetriesPerRequest: null, // Required for BullMQ
  connectTimeout: 20000, // 20s connection timeout for slower CI environments
  keepAlive: 10000, // Send TCP keepalive to prevent idle disconnection
  retryStrategy: (times: number) => Math.min(times * 100, 3000), // Exponential backoff, max 3s
};

// Monobank's API rate limit (~1 req / 60s per endpoint) is enforced per
// API token, not per IP. A single global queue + worker therefore serializes
// every Monobank user — Dmytro syncing blocks Evelina syncing even though
// their tokens are independent. We instead create one queue + worker per
// API-token hash, so each token gets its own rate-limited lane and tokens
// run in parallel.
//
// Bundles are created lazily on first enqueue and re-created at startup via
// `ensureMonobankQueueRecovery()` so pending jobs in Redis resume processing
// after a restart, even before any new sync is requested for that token.
//
// The JEST_WORKER_ID suffix isolates each parallel test worker's namespace;
// the tokenHash suffix isolates per-token traffic.
const QUEUE_NAME_BASE =
  process.env.NODE_ENV === 'test' && process.env.JEST_WORKER_ID
    ? `monobank-transaction-sync-worker-${process.env.JEST_WORKER_ID}`
    : 'monobank-transaction-sync';

const TOKEN_HASH_LENGTH = 16;

function hashApiToken(apiToken: string): string {
  return crypto.createHash('sha256').update(apiToken).digest('hex').slice(0, TOKEN_HASH_LENGTH);
}

// BullMQ rejects `:` in queue names (it uses `:` internally for Redis key
// segments), so a non-colon separator is required between the base and the
// per-token suffix.
const QUEUE_NAME_SEP = '_';

function queueNameForTokenHash(tokenHash: string): string {
  return `${QUEUE_NAME_BASE}${QUEUE_NAME_SEP}${tokenHash}`;
}

interface QueueBundle {
  tokenHash: string;
  queueName: string;
  queue: Queue<TransactionSyncJobData>;
  worker: Worker<TransactionSyncJobData>;
}

const bundles = new Map<string, QueueBundle>();

const queueDefaultJobOptions = {
  attempts: 2,
  backoff: {
    type: 'exponential' as const,
    delay: 60000, // Start with 60 seconds due to Monobank rate limits
  },
  removeOnComplete: {
    age: 1800, // Keep completed jobs for 30 mins (just in case)
    count: 20, // Keep last 20 completed jobs
  },
  removeOnFail: {
    age: 7200, // Keep failed jobs for 2 hours
  },
};

function buildJobProcessor(queueName: string) {
  return async (job: Job<TransactionSyncJobData>) => {
    return withQueueProcessSpan({
      queueName,
      job,
      fn: async () => {
        const { userId, accountId, externalAccountId, apiToken, fromTimestamp, toTimestamp, batchIndex, totalBatches } =
          job.data;

        logger.info(
          `[WORKER] Processing Monobank transaction sync batch ${batchIndex + 1}/${totalBatches} for account ${accountId} (externalId: ${externalAccountId})`,
        );

        // A base-currency recalculation is draining in-flight writers before it
        // snapshots rows; committing more old-base transactions now would corrupt
        // the migration. Abort this batch before any write and mark the account
        // COMPLETED so the recalc's drain — which blocks while any of the user's
        // accounts sit QUEUED/SYNCING — stops waiting on it. The skipped, deduped
        // date range is re-fetched by the next auto-sync.
        if (await isBaseCurrencyChangeLocked({ userId })) {
          await setAccountSyncStatus({ accountId, status: SyncStatus.COMPLETED, userId });
          logger.info(
            `[WORKER] Skipping Monobank batch ${batchIndex + 1}/${totalBatches} for account ${accountId}: base currency change in progress`,
          );
          return { success: false, batchIndex, totalBatches, transactionCount: 0 };
        }

        // Set status to SYNCING when worker starts (only for first batch)
        if (batchIndex === 0) {
          await setAccountSyncStatus({ accountId, status: SyncStatus.SYNCING, userId });
        }

        // Update job progress
        await job.updateProgress({
          batchIndex,
          totalBatches,
          status: 'fetching',
        });

        try {
          const apiClient = new MonobankApiClient(apiToken);

          // Fetch transactions from Monobank API
          const transactions = await apiClient.getStatement(externalAccountId, fromTimestamp, toTimestamp);

          logger.info(
            `[WORKER] Fetched ${transactions.length} transactions for batch ${batchIndex + 1}/${totalBatches}`,
          );

          // Update job progress
          await job.updateProgress({
            batchIndex,
            totalBatches,
            status: 'processing',
            transactionCount: transactions.length,
          });

          // Process each transaction and collect created IDs
          const createdTransactionIds: string[] = [];
          let mergedIntoPlannedCount = 0;

          // One probe per batch instead of one per row: an account with no plans skips the
          // matcher entirely.
          const matchPlanned = job.data.matchPlanned === true && (await accountHasPlannedRows({ accountId }));

          // Sort transactions by date (ascending) so the last transaction for each day
          // This is important for Balances.handleTransactionChange() which uses the
          // balance from the last-processed transaction for each date.
          transactions.sort((a, b) => a.time - b.time);

          for (let i = 0; i < transactions.length; i++) {
            const result = await createMonobankTransaction({
              data: transactions[i]!,
              accountId,
              userId,
              matchPlanned,
            });
            if (result.mergedIntoPlanned) {
              mergedIntoPlannedCount += 1;
            } else if (result.createdId !== undefined) {
              createdTransactionIds.push(result.createdId);
            }

            // Update progress periodically
            if (i % 10 === 0) {
              await job.updateProgress({
                batchIndex,
                totalBatches,
                status: 'processing',
                transactionCount: transactions.length,
                processedCount: i + 1,
              });
            }
          }

          await linkAndEmitSyncedTransactions({ userId, accountId, transactionIds: createdTransactionIds });

          if (mergedIntoPlannedCount > 0) {
            logger.info(
              `[WORKER] Batch ${batchIndex + 1}/${totalBatches}: ${mergedIntoPlannedCount} planned transaction(s) confirmed for account ${accountId}`,
            );
            await notifyPlannedConfirmations({ userId, accountId, mergedCount: mergedIntoPlannedCount });
          }

          // Update account metadata and balance after processing all transactions in this batch.
          const account = await Accounts.findByPk(accountId);

          if (account) {
            // Stamp lastSyncedAt via jsonb_set: a whole-blob read-modify-write
            // races concurrent metadata writers (the completion path clearing
            // `pendingAbsorb`, the link flow writing bankConnection) and would
            // resurrect cleared flags.
            await Accounts.sequelize!.query(
              `UPDATE "Accounts"
               SET "externalData" = jsonb_set(COALESCE("externalData", '{}'::jsonb), '{lastSyncedAt}', to_jsonb(:lastSyncedAt::text))
               WHERE "id" = :accountId`,
              { replacements: { lastSyncedAt: new Date().toISOString(), accountId } },
            );

            // Update account balance to reflect the current state from Monobank.
            // Monobank API returns transactions in chronological order (oldest to newest),
            // and each transaction includes the account balance AFTER that transaction.
            // The most recent stored transaction's `externalData.balance` is the
            // authoritative current balance, regardless of which batch finished last.
            // `writeBankBalanceWithHistory` writes the row, refCurrentBalance, and the
            // Balances snapshot for today via a race-safe upsert — concurrent batches
            // serialize at the unique (accountId, date) index.
            if (transactions.length > 0) {
              const newestTransactionInDb = await findOneTransaction({
                planned: 'exclude',
                access: { creator: userId },
                balanceAdjustments: 'include',
                where: {
                  accountId,
                },
                // When two transactions share the same `time`, prefer the one
                // created most recently. Without ['createdAt', 'DESC'] the
                // database can return an older row – after a re-sync that
                // means we'd save its outdated balance
                order: [
                  ['time', 'DESC'],
                  ['createdAt', 'DESC'],
                ],
                attributes: ['externalData'],
                raw: true,
              });

              if (newestTransactionInDb) {
                const balanceFromExternalData = newestTransactionInDb.externalData?.balance;

                logger.info(
                  `Batch ${batchIndex + 1}/${totalBatches}: Updating account ${accountId} balance from newest transaction. ` +
                    `Current: ${account.currentBalance}, Latest tx balance: ${balanceFromExternalData}, Transactions processed: ${transactions.length}`,
                );

                if (balanceFromExternalData !== undefined) {
                  await writeBankBalanceWithHistory({
                    account,
                    balance: Money.fromCents(balanceFromExternalData),
                  });
                } else {
                  logger.error(
                    "[Monobank transactions sync]: latest monobank transaction doesn't have balance in externalData",
                    { newestTransactionInDb },
                  );
                }
              } else {
                logger.error(`[Monobank transactions sync]: no transactions found in the DB after syncing account: `, {
                  account,
                });
              }
            }

            logger.info(`Account ${accountId} balance after save: ${account.currentBalance}`);
          }

          logger.info(`[WORKER] Completed batch ${batchIndex + 1}/${totalBatches} for account ${accountId}`);

          return {
            success: true,
            batchIndex,
            totalBatches,
            transactionCount: transactions.length,
          };
        } catch (error) {
          logger.error({
            message: `[WORKER] Error processing batch ${batchIndex + 1}/${totalBatches}`,
            error: error as Error,
          });

          // Set status to FAILED
          await setAccountSyncStatus({
            accountId,
            status: SyncStatus.FAILED,
            error: (error as Error).message,
            userId,
          });

          // Neither a geo-block from Monobank's edge nor an account id Monobank
          // no longer recognises clears up by retrying 60s later — the server's
          // IP and the stored external id are both unchanged between attempts.
          // Mark unrecoverable so BullMQ stops the retry cascade and we don't
          // burn the per-token rate-limit slot for the next genuine request.
          if (error instanceof MonobankGeoBlockedError || error instanceof MonobankAccountNotFoundError) {
            throw new UnrecoverableError((error as Error).message);
          }

          throw error; // Will trigger retry
        }
      },
    });
  };
}

function createBundle(tokenHash: string): QueueBundle {
  const queueName = queueNameForTokenHash(tokenHash);

  const queue = new Queue<TransactionSyncJobData>(queueName, {
    connection,
    defaultJobOptions: queueDefaultJobOptions,
  });

  queue.on('error', (err) => {
    // Ignore "Connection is closed" errors during test teardown
    if (!err.message.includes('Connection is closed')) {
      logger.error({ message: `Queue error (${queueName})`, error: err });
    }
  });

  const processJob = buildJobProcessor(queueName);
  const worker = new Worker<TransactionSyncJobData>(
    queueName,
    (job) => runWithBalanceRevalueBatch(() => processJob(job)),
    {
      connection,
      concurrency: 1, // Process one job at a time per worker (one token's rate-limit lane)
      // Only enable rate limiter in production (not in tests)
      ...(process.env.NODE_ENV !== 'test' && {
        limiter: {
          max: 1, // Max jobs per duration
          duration: 60000, // 60 seconds - Monobank per-token rate limit
        },
      }),
    },
  );

  worker.on('completed', (job) => handleCompletedBatch(job));

  worker.on('failed', (job, err) => {
    logger.error({ message: `Job ${job?.id} failed (${queueName})`, error: err });
  });

  worker.on('error', (err) => {
    // Ignore "Connection is closed" errors during test teardown
    if (!err.message.includes('Connection is closed')) {
      logger.error({ message: `Worker error (${queueName})`, error: err });
    }
  });

  return { tokenHash, queueName, queue, worker };
}

function getOrCreateBundle(apiToken: string): QueueBundle {
  const tokenHash = hashApiToken(apiToken);
  let bundle = bundles.get(tokenHash);
  if (!bundle) {
    bundle = createBundle(tokenHash);
    bundles.set(tokenHash, bundle);
  }
  return bundle;
}

/**
 * Snapshot of all currently-instantiated per-token queue+worker pairs.
 * Used by sweep-style operations (read-across-queues, bulk close, user delete).
 */
function getAllMonobankQueueBundles(): readonly QueueBundle[] {
  return [...bundles.values()];
}

/**
 * Tear down every queue + worker. Used in test teardown and graceful shutdown.
 */
export async function closeAllMonobankQueueBundles(): Promise<void> {
  const all = [...bundles.values()];
  bundles.clear();
  await Promise.all(all.map((b) => b.worker.close()));
  await Promise.all(all.map((b) => b.queue.close()));
}

// Recovery runs at most once per process. Read-side callers await the same
// promise so they don't act on an empty bundle Map immediately after boot.
let recoveryPromise: Promise<void> | undefined;

/**
 * Scan Redis for existing per-token queues and re-create their in-memory
 * bundles so workers resume processing pending jobs after a restart.
 *
 * Without this, jobs sitting in Redis for tokens that haven't been re-used
 * since the restart would never be picked up — no worker is bound to that
 * queue name until something calls `getOrCreateBundle` for that token again.
 */
export function ensureMonobankQueueRecovery(): Promise<void> {
  if (!recoveryPromise) {
    recoveryPromise = recoverExistingQueues().catch((error) => {
      // Reset so a later call can retry; recovery failure shouldn't permanently
      // wedge the module.
      recoveryPromise = undefined;
      logger.error({ message: '[Monobank] Queue recovery scan failed', error: error as Error });
      throw error;
    });
  }
  return recoveryPromise;
}

async function recoverExistingQueues(): Promise<void> {
  // Use a dedicated short-lived Redis client without keyPrefix so we can
  // SCAN BullMQ's raw `bull:*` keys (the shared redisClient has a Jest-worker
  // prefix that would mis-scope the pattern).
  const scanClient = new IORedis({
    host: process.env.APPLICATION_REDIS_HOST,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });

  try {
    await scanClient.connect();

    const pattern = `bull:${QUEUE_NAME_BASE}${QUEUE_NAME_SEP}*`;
    const discovered = new Set<string>();
    let cursor = '0';

    do {
      const [next, keys] = await scanClient.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      const prefix = `bull:${QUEUE_NAME_BASE}${QUEUE_NAME_SEP}`;
      for (const key of keys) {
        if (!key.startsWith(prefix)) continue;
        // key = bull:<QUEUE_NAME_BASE>_<tokenHash>[:<sub-key>]
        const rest = key.slice(prefix.length);
        const colon = rest.indexOf(':');
        const tokenHash = colon === -1 ? rest : rest.slice(0, colon);
        if (tokenHash.length === TOKEN_HASH_LENGTH) {
          discovered.add(tokenHash);
        }
      }
    } while (cursor !== '0');

    for (const tokenHash of discovered) {
      if (!bundles.has(tokenHash)) {
        bundles.set(tokenHash, createBundle(tokenHash));
      }
    }

    logger.info(
      `[Monobank] Queue recovery: discovered ${discovered.size} existing queue(s), ${bundles.size} bundle(s) now active`,
    );
  } finally {
    await scanClient.quit().catch(() => {
      // ignore — short-lived scan client
    });
  }
}

/**
 * Create transaction from Monobank API response.
 * Returns the created transaction ID, or undefined if skipped (duplicate) or merged into a
 * planned row.
 */
async function createMonobankTransaction({
  data,
  accountId,
  userId,
  matchPlanned,
}: {
  data: ExternalMonobankTransactionResponse;
  accountId: string;
  userId: number;
  matchPlanned: boolean;
}): Promise<{ createdId?: string; mergedIntoPlanned: boolean }> {
  // Check if transaction already exists (duplicate prevention)
  const isTransactionExists = await findOneTransaction({
    planned: 'exclude',
    access: { creator: userId },
    balanceAdjustments: 'include',
    where: {
      originalId: data.id,
      accountId,
    },
    paranoid: false,
  });

  if (isTransactionExists) {
    logger.info(`Transaction ${data.id} already exists, skipping`);
    return { mergedIntoPlanned: false };
  }

  // Get or create MCC code
  let mccRecord = await MerchantCategoryCodes.getByCode({ code: data.mcc });

  if (!mccRecord) {
    mccRecord = await MerchantCategoryCodes.addCode({ code: data.mcc });
  }

  // Get or create user MCC mapping to category
  const userMcc = await UserMerchantCategoryCodes.getByPassedParams({
    mccId: mccRecord.get('id'),
    userId,
  });

  let categoryId: string;
  // Distinguishes "this categoryId came from the user's MCC mapping" (which
  // `payee_rule` is allowed to override) from "this is just the default
  // fallback" (which leaves `categorizationMeta` null so any later source can
  // claim the row).
  let mccFromUserMapping = false;

  if (userMcc.length) {
    categoryId = userMcc[0]!.get('categoryId');
    mccFromUserMapping = true;
  } else {
    // Use default category for this user
    categoryId = await Users.getUserDefaultCategory({ id: userId });

    // Create mapping for future transactions
    await UserMerchantCategoryCodes.createEntry({
      mccId: mccRecord.get('id'),
      userId,
      categoryId,
    });
  }

  // Create transaction in database. `counterName` is the Monobank-reported
  // merchant string — surfaced both into `externalData` for audit and as
  // `rawMerchantName` so the createTransaction pipeline can resolve a Payee.
  // `categorizationMeta` flags MCC-derived categories so `payee_rule` knows it
  // may override them; the user-default fallback path leaves meta null on
  // purpose so any later source can still win.
  const counterName = data.counterName?.trim() ?? '';
  const mccDerivedMeta = mccFromUserMapping
    ? {
        source: CATEGORIZATION_SOURCE.mccRule,
        categorizedAt: new Date().toISOString(),
      }
    : null;
  const createResult = await transactionsService.createTransaction({
    originalId: data.id,
    note: data.description,
    externalReference: (data.receiptId?.trim() || data.invoiceId?.trim())?.slice(0, 255) || null,
    amount: Money.fromCents(Math.abs(data.amount)),
    time: new Date(data.time * 1000),
    externalData: {
      operationAmount: data.operationAmount,
      receiptId: data.receiptId,
      balance: data.balance,
      hold: data.hold,
      counterName: counterName || undefined,
    },
    commissionRate: Money.fromCents(data.commissionRate),
    cashbackAmount: Money.fromCents(data.cashbackAmount),
    accountId,
    userId,
    transactionType: data.amount > 0 ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
    paymentType: PAYMENT_TYPES.creditCard,
    categoryId,
    categorizationMeta: mccDerivedMeta,
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    accountType: ACCOUNT_TYPES.monobank,
    rawMerchantName: counterName || null,
    matchPlanned,
  });

  const [createdTx] = createResult;

  if (createResult.mergedIntoPlanned) {
    logger.info(`Merged Monobank transaction ${data.id} into planned transaction ${createdTx.id}`);
    return { mergedIntoPlanned: true };
  }

  logger.info(`Created Monobank transaction: ${data.id}, amount: ${data.amount}`);
  return { createdId: createdTx.id, mergedIntoPlanned: false };
}

// 24h safety TTL: if the worker crashes between intermediate batches, the
// counter key expires rather than lingering in Redis forever.
const JOB_GROUP_COMPLETIONS_TTL_SECONDS = 24 * 60 * 60;

function jobGroupCompletionsKey(jobGroupId: string): string {
  return `jobgroup:${jobGroupId}:completions`;
}

/**
 * Runs the deferred post-link absorb before flipping the status to COMPLETED,
 * so status waiters observe the reconciled account.
 *
 * `swallowAbsorbError` is safe only where no ambient CLS transaction exists
 * (the worker's 'completed' event): there a failed absorb rolls itself back
 * and the still-set `pendingAbsorb` retries next group. Inside an ambient
 * transaction the error must propagate, or a half-applied opening-balance
 * move commits.
 */
async function finalizeSyncGroup({
  accountId,
  userId,
  connectionId,
  swallowAbsorbError,
}: {
  accountId: RecordId;
  userId: number;
  connectionId: string;
  swallowAbsorbError: boolean;
}): Promise<void> {
  if (swallowAbsorbError) {
    try {
      await runPendingLinkAbsorb({ accountId: String(accountId), userId });
    } catch (error) {
      logger.error(
        { message: '[Monobank] Deferred post-link residual absorb failed', error: error as Error },
        { accountId, userId },
      );
    }
  } else {
    await runPendingLinkAbsorb({ accountId: String(accountId), userId });
  }

  await Promise.all([
    setAccountSyncStatus({ accountId, status: SyncStatus.COMPLETED, userId }),
    // Nothing else stamps the connection's lastSyncAt in the queued flow, so
    // the list view's "Last synced" column would never move without this.
    BankDataProviderConnections.update({ lastSyncAt: new Date() }, { where: { id: connectionId } }),
  ]);
}

/**
 * Handles a batch job's 'completed' event.
 *
 * Uses an atomic Redis counter (INCR) keyed by jobGroupId rather than
 * enumerating the queue's completed set. The queue trims completed jobs via
 * `removeOnComplete.count` — under concurrent syncs this can evict earlier
 * batches of *this* group before the last one fires, and any approach that
 * derives "are we done?" from the queue snapshot is racy. A dedicated counter
 * is immune: each successful batch contributes exactly one INCR, and the call
 * that returns `totalBatches` is the one that fires the final transition.
 *
 * Exported for direct testing.
 */
export async function handleCompletedBatch(job: Job<TransactionSyncJobData>): Promise<void> {
  logger.info(`Job ${job.id} completed successfully`);

  const jobId = job.id;
  if (!jobId) return;
  const jobGroupId = jobId.substring(0, jobId.lastIndexOf('-'));
  const { totalBatches, accountId, userId, connectionId } = job.data;

  const counterKey = jobGroupCompletionsKey(jobGroupId);
  const completedCount = await redisClient.incr(counterKey);
  await redisClient.expire(counterKey, JOB_GROUP_COMPLETIONS_TTL_SECONDS);

  if (completedCount < totalBatches) return;

  await finalizeSyncGroup({ accountId, userId, connectionId, swallowAbsorbError: true });
  await redisClient.del(counterKey);
  logger.info(`All batches completed for account ${accountId}, status set to COMPLETED`);
}

/**
 * Split date range into 31-day chunks (Monobank API limitation)
 * Returns chunks in DESCENDING order (newest first) for better UX
 */
function splitDateRangeIntoChunks(from: Date, to: Date): Array<{ from: Date; to: Date }> {
  const chunks: Array<{ from: Date; to: Date }> = [];
  const MAX_DAYS = 31;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  let currentFrom = new Date(from);
  const endDate = new Date(to);

  while (currentFrom < endDate) {
    const currentTo = new Date(Math.min(currentFrom.getTime() + MAX_DAYS * MS_PER_DAY, endDate.getTime()));

    chunks.push({
      from: new Date(currentFrom),
      to: new Date(currentTo),
    });

    currentFrom = new Date(currentTo.getTime() + 1); // Move to next day
  }

  // Reverse to process newest transactions first
  return chunks.toReversed();
}

/**
 * All accounts on one token share a single rate-limited lane, so a stale
 * account's multi-chunk backfill must not delay an active account's one chunk.
 * Priority grows with days since the last known transaction; an account with
 * no rows yet is the one the user is waiting on and goes first.
 */
export function syncPriorityForAccount({ latestTransactionTime }: { latestTransactionTime?: Date | null }): number {
  if (!latestTransactionTime) return 1;
  const days = Math.ceil((Date.now() - latestTransactionTime.getTime()) / 86_400_000);
  return Math.min(Math.max(1, days), 2 ** 21 - 1);
}

/**
 * Queue transaction sync job for a date range
 * Automatically splits into 31-day chunks
 */
export async function queueTransactionSync(params: {
  userId: number;
  accountId: RecordId;
  connectionId: string;
  externalAccountId: string;
  apiToken: string;
  from: Date;
  to: Date;
  matchPlanned?: boolean;
  /** BullMQ priority (lower runs sooner). Omitted = 0 = ahead of every prioritized job. */
  priority?: number;
}): Promise<{ jobGroupId: string; totalBatches: number; estimatedMinutes: number }> {
  const {
    userId,
    accountId,
    connectionId,
    externalAccountId,
    apiToken,
    from,
    to,
    matchPlanned = false,
    priority,
  } = params;

  const bundle = getOrCreateBundle(apiToken);

  // Split date range into chunks
  const chunks = splitDateRangeIntoChunks(from, to);

  // Generate unique group ID for this sync operation
  const jobGroupId = `${userId}-${accountId}-${Date.now()}`;

  // An empty window (from >= to, e.g. the forward-only clamp) enqueues no
  // batches, so no worker completion ever fires: finalize here or the account
  // sits in QUEUED forever and a pending link absorb never runs.
  if (chunks.length === 0) {
    await finalizeSyncGroup({ accountId, userId, connectionId, swallowAbsorbError: false });
    logger.info(`[QUEUE] Empty sync window for account ${accountId} (group: ${jobGroupId}), finalized without batches`);
    return { jobGroupId, totalBatches: 0, estimatedMinutes: 0 };
  }

  // Queue jobs for each chunk, wrapped in a Sentry publish span
  await withQueuePublishSpan({
    queueName: bundle.queueName,
    messageId: jobGroupId,
    payloadSize: chunks.length * 200, // approximate per-job size
    fn: async (traceData) => {
      const jobs = chunks.map((chunk, index) => ({
        name: `sync-${jobGroupId}-${index}`,
        data: {
          userId,
          accountId,
          connectionId,
          externalAccountId,
          apiToken,
          fromTimestamp: Math.floor(chunk.from.getTime() / 1000),
          toTimestamp: Math.floor(chunk.to.getTime() / 1000),
          batchIndex: index,
          totalBatches: chunks.length,
          matchPlanned,
          ...traceData,
        },
        opts: {
          jobId: `${jobGroupId}-${index}`,
          priority,
        },
      }));

      await bundle.queue.addBulk(jobs);
    },
  });

  logger.info(
    `[QUEUE] Queued ${chunks.length} batch(es) for transaction sync (group: ${jobGroupId}, queue: ${bundle.queueName})`,
  );

  // Each batch takes ~60 seconds due to rate limiting
  const estimatedMinutes = Math.max(1, chunks.length - 1); // First batch starts immediately

  return {
    jobGroupId,
    totalBatches: chunks.length,
    estimatedMinutes,
  };
}

/**
 * Get job progress for a group of jobs.
 *
 * A jobGroupId lives in exactly one per-token queue (the one that owned the
 * token at enqueue time), but the caller doesn't know which. We scan every
 * known bundle and aggregate — cost scales with active-token count, which is
 * small (one entry per Monobank user with traffic since boot/recovery).
 */
export async function getJobGroupProgress({ jobGroupId, userId }: { jobGroupId: string; userId: number }): Promise<{
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
  activeBatches: number;
  waitingBatches: number;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'partial';
  progress?: unknown;
}> {
  await ensureMonobankQueueRecovery();

  const allBundles = getAllMonobankQueueBundles();

  // Fetch jobs by state separately to avoid duplicates
  const perBundle = await Promise.all(
    allBundles.map(async (bundle) => {
      const [waitingJobs, activeJobs, completedJobs, failedJobs] = await Promise.all([
        bundle.queue.getJobs(['waiting']),
        bundle.queue.getJobs(['active']),
        bundle.queue.getJobs(['completed']),
        bundle.queue.getJobs(['failed']),
      ]);
      return { waitingJobs, activeJobs, completedJobs, failedJobs };
    }),
  );

  // Scope to the caller: an attacker-supplied jobGroupId (another user's id, or
  // empty) must not match foreign jobs. `job.data.userId` is the authoritative
  // owner; the `-` boundary stops a bare-id prefix widening ("5" matching "50-…").
  const matches = (jobs: Job[]) =>
    jobs.filter((job) => job.data.userId === userId && job.id?.startsWith(`${jobGroupId}-`));
  const waitingGroupJobs = perBundle.flatMap((b) => matches(b.waitingJobs));
  const activeGroupJobs = perBundle.flatMap((b) => matches(b.activeJobs));
  const completedGroupJobs = perBundle.flatMap((b) => matches(b.completedJobs));
  const failedGroupJobs = perBundle.flatMap((b) => matches(b.failedJobs));

  const waitingBatches = waitingGroupJobs.length;
  const activeBatches = activeGroupJobs.length;
  const completedBatches = completedGroupJobs.length;
  const failedBatches = failedGroupJobs.length;
  const totalBatches = waitingBatches + activeBatches + completedBatches + failedBatches;

  if (totalBatches === 0) {
    return {
      totalBatches: 0,
      completedBatches: 0,
      failedBatches: 0,
      activeBatches: 0,
      waitingBatches: 0,
      status: 'completed', // Assume completed if no jobs found (cleaned up)
    };
  }

  logger.info(
    `Job group ${jobGroupId} progress: ${completedBatches}/${totalBatches} completed, ${activeBatches} active, ${waitingBatches} waiting, ${failedBatches} failed`,
  );

  // Get progress from active job if any
  const activeJob = activeGroupJobs[0];
  const progress = activeJob?.progress;

  // Determine overall status
  let status: 'waiting' | 'active' | 'completed' | 'failed' | 'partial';
  if (completedBatches === totalBatches) {
    status = 'completed';
  } else if (failedBatches > 0 && completedBatches + failedBatches === totalBatches) {
    status = 'failed';
  } else if (activeBatches > 0) {
    status = 'active';
  } else if (waitingBatches > 0) {
    status = 'waiting';
  } else {
    status = 'partial';
  }

  return {
    totalBatches,
    completedBatches,
    failedBatches,
    activeBatches,
    waitingBatches,
    status,
    progress,
  };
}

/**
 * Get all active job groups for a specific user
 * Returns list of jobGroupIds that are still in progress
 */
export async function getActiveJobsForUser(userId: number): Promise<
  Array<{
    jobGroupId: string;
    connectionId: string;
    accountId: string;
    status: 'waiting' | 'active';
  }>
> {
  await ensureMonobankQueueRecovery();

  const allBundles = getAllMonobankQueueBundles();
  const jobsPerBundle = await Promise.all(allBundles.map((b) => b.queue.getJobs(['waiting', 'active'])));
  const jobs = jobsPerBundle.flat();

  // Group jobs by jobGroupId
  const jobGroups = new Map<string, Array<{ accountId: string }>>();

  jobs.forEach((job) => {
    const jobId = job.id;
    if (!jobId) return;

    // Extract jobGroupId (everything before the last dash)
    const lastDashIndex = jobId.lastIndexOf('-');
    if (lastDashIndex === -1) return;

    const jobGroupId = jobId.substring(0, lastDashIndex);

    // Check if this job belongs to the user (jobGroupId format: userId-accountId-timestamp)
    const userIdFromJob = parseInt(jobGroupId.split('-')[0] || '');
    if (userIdFromJob !== userId) return;

    // Extract accountId from job data
    const { accountId } = job.data;

    if (!jobGroups.has(jobGroupId)) {
      jobGroups.set(jobGroupId, []);
    }
    jobGroups.get(jobGroupId)!.push({ accountId });
  });

  // Convert to array with status
  const result: Array<{
    jobGroupId: string;
    connectionId: string;
    accountId: string;
    status: 'waiting' | 'active';
  }> = [];

  for (const [jobGroupId, jobData] of jobGroups.entries()) {
    if (jobData.length > 0) {
      // Get status of the group and connectionId from first job
      const groupJobs = jobs.filter((job) => job.id?.startsWith(jobGroupId));
      const firstJob = groupJobs[0];
      if (!firstJob) continue;

      const hasActive = groupJobs.some((job) => job.isActive());
      const status = hasActive ? 'active' : 'waiting';

      // Get connectionId from the job data
      const connectionId = firstJob.data.connectionId;

      result.push({
        jobGroupId,
        connectionId,
        accountId: jobData[0]!.accountId,
        status,
      });
    }
  }

  return result;
}

/**
 * Remove all pending/delayed jobs belonging to a user across every per-token
 * queue. Used during user deletion so leftover work doesn't try to touch
 * tables of a user that no longer exists. 'active' jobs are locked by their
 * worker and intentionally skipped — they finish on their own.
 */
/**
 * Force a fresh recovery scan, bypassing the memoized `ensureMonobankQueueRecovery`,
 * so per-token bundles created since boot — including by another process — are
 * discovered. The base-currency drain calls this before counting a user's
 * in-flight sync jobs.
 */
export async function refreshMonobankBundleDiscovery(): Promise<void> {
  await recoverExistingQueues();
}

/**
 * Count a user's not-yet-finished sync jobs (active + waiting + delayed) across
 * every per-token queue. `delayed` is included because jobs sit delayed between
 * 60s rate-limited batches — an active-only count would report "clear" while a
 * batch is still pending. Reads the currently-known bundles; call
 * {@link refreshMonobankBundleDiscovery} first to pick up bundles from other processes.
 */
export async function countUnfinishedMonobankJobsForUser({ userId }: { userId: number }): Promise<number> {
  const allBundles = getAllMonobankQueueBundles();
  const jobsPerBundle = await Promise.all(allBundles.map((b) => b.queue.getJobs(['active', 'waiting', 'delayed'])));
  return jobsPerBundle.flat().filter((job) => job.data.userId === userId).length;
}

export async function removePendingJobsForUser({
  userId,
}: {
  userId: number;
}): Promise<{ removedAccountIds: string[] }> {
  await ensureMonobankQueueRecovery();

  const allBundles = getAllMonobankQueueBundles();
  const jobsPerBundle = await Promise.all(allBundles.map((b) => b.queue.getJobs(['waiting', 'delayed'])));
  const userJobs = jobsPerBundle.flat().filter((job) => job.data.userId === userId);

  const removedAccountIds = new Set<string>();
  await Promise.all(
    userJobs.map((job) =>
      job
        .remove()
        .then(() => {
          removedAccountIds.add(String(job.data.accountId));
        })
        .catch((error) => {
          // Job may have become active between getJobs and remove - ignore lock errors,
          // but log the actual error so we can spot non-lock failures (Redis disconnect,
          // etc.) instead of misattributing every miss to a transient lock race.
          logger.warn(`Could not remove job during user deletion. jobId: ${job.id}`, { error: error as Error });
        }),
    ),
  );

  return { removedAccountIds: [...removedAccountIds] };
}
