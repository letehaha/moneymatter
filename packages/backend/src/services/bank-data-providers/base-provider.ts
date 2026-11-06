/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEACTIVATION_REASON, type DeactivationReason, type RecordId } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ForbiddenError, ServiceUnavailableError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { isDeadlockError } from '@services/common/retry-on-deadlock';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { SyncStatus, setAccountSyncStatus } from './sync/sync-status-tracker';
import {
  DateRange,
  IBankDataProvider,
  LoadTransactionsForPeriodResult,
  ProviderAccount,
  ProviderBalance,
  ProviderMetadata,
  ProviderTransaction,
} from './types';
import { linkAndEmitSyncedTransactions } from './utils/link-and-emit-synced-transactions';

/**
 * Shape of connection-metadata fields used by the shared auth-failure
 * tracking. Provider-specific metadata interfaces should include these
 * fields (and may add their own).
 */
interface AuthTrackingMetadata {
  consecutiveAuthFailures?: number;
  deactivationReason?: DeactivationReason | null;
}

/**
 * After this many consecutive auth failures the connection is auto-deactivated
 * to stop us hammering the upstream with bad credentials.
 */
const AUTH_FAILURE_DEACTIVATION_THRESHOLD = 2;

/**
 * Thrown from a provider's per-row persist loop to unwind an inline sync when a
 * base-currency recalculation acquires the user's lock mid-run. runSyncWithStatus
 * catches it and marks the account FAILED — a terminal state, so the recalc's
 * drain (which waits while any of the user's accounts are QUEUED/SYNCING) stops
 * waiting. The next auto-sync re-fetches the skipped, deduped rows.
 */
class BaseCurrencyChangeLockedError extends Error {
  constructor() {
    super(t({ key: 'currencies.baseCurrencyChangeInProgress' }));
    this.name = 'BaseCurrencyChangeLockedError';
  }
}

/**
 * Abstract base class for all bank data providers.
 * Provides common functionality and enforces implementation of required methods.
 *
 * All providers (Monobank, Enable Banking, etc.) should extend this class.
 */
export abstract class BaseBankDataProvider implements IBankDataProvider {
  // ============================================================================
  // Abstract Properties - Must be implemented by child classes
  // ============================================================================

  /**
   * Provider metadata (name, features, credential fields, etc.)
   * Must be defined by each provider implementation
   */
  abstract readonly metadata: ProviderMetadata;

  // ============================================================================
  // Helper Methods - Available to all providers
  // ============================================================================

  /**
   * Get a connection from database by ID
   * @param connectionId - Connection ID to fetch
   * @returns Connection model instance
   * @throws NotFoundError if connection not found
   */
  protected async getConnection(connectionId: string): Promise<BankDataProviderConnections> {
    return findOrThrowNotFound({
      query: BankDataProviderConnections.findByPk(connectionId),
      message: t({ key: 'errors.connectionIdNotFound', variables: { connectionId } }),
    });
  }

  /**
   * Update last sync timestamp for a connection
   * @param connectionId - Connection ID to update
   */
  protected async updateLastSync(connectionId: string): Promise<void> {
    await BankDataProviderConnections.update({ lastSyncAt: new Date() }, { where: { id: connectionId } });
  }

  /**
   * Get a system account by ID
   * @param systemAccountId - Account ID to fetch
   * @returns Account model instance
   * @throws NotFoundError if account not found
   */
  protected async getSystemAccount(systemAccountId: string): Promise<Accounts> {
    return findOrThrowNotFound({
      query: Accounts.findByPk(systemAccountId),
      message: t({ key: 'errors.accountIdNotFound', variables: { accountId: systemAccountId } }),
    });
  }

  /**
   * Get decrypted credentials for a connection
   * @param connectionId - Connection ID
   * @returns Decrypted credentials object
   */
  protected async getDecryptedCredentials(connectionId: string): Promise<Record<string, unknown>> {
    const connection = await this.getConnection(connectionId);
    return connection.getDecryptedCredentials();
  }

  // ============================================================================
  // Auth Failure Tracking
  // ============================================================================

  /**
   * Whether a thrown error represents an auth failure for this provider.
   * Default treats any `ForbiddenError` as an auth failure. Providers whose
   * upstream returns auth failures via different mechanisms (e.g. HTTP 401/403
   * wrapped in a custom error class) should override this.
   */
  protected isAuthError(error: unknown): boolean {
    return error instanceof ForbiddenError;
  }

  /**
   * Increment the connection's consecutive auth-failure counter and deactivate
   * the connection once the threshold is reached. Called by providers in the
   * catch branch of an authenticated call. No-ops for non-auth errors so call
   * sites can pass any caught error.
   */
  protected async handleAuthError({ connectionId, error }: { connectionId: string; error: unknown }): Promise<void> {
    if (!this.isAuthError(error)) return;

    try {
      const connection = await this.getConnection(connectionId);
      // Spread into a NEW object: Sequelize only flags a JSON(B) column dirty
      // when its reference changes, so mutating the existing metadata in place
      // and re-assigning the same reference would not persist on save().
      const metadata: AuthTrackingMetadata = { ...(connection.metadata as AuthTrackingMetadata) };
      const failures = (metadata.consecutiveAuthFailures || 0) + 1;
      metadata.consecutiveAuthFailures = failures;

      if (failures >= AUTH_FAILURE_DEACTIVATION_THRESHOLD) {
        connection.isActive = false;
        metadata.deactivationReason = DEACTIVATION_REASON.AUTH_FAILURE;
        // Designed response to a user's credentials going stale, surfaced by
        // the connection-status badge — not a fault worth a Sentry event.
        logger.info(
          `[${this.metadata.name}] Connection ${connectionId} deactivated after ${failures} consecutive auth failures`,
        );
      }

      connection.metadata = metadata as any;
      // `{ transaction: null }` bypasses the ambient CLS transaction: an auth
      // failure surfaces while a sync is being rolled back, so this write must
      // commit independently or the failure count (and deactivation) would be
      // undone by that rollback.
      await connection.save({ transaction: null });
    } catch (metaError) {
      logger.error({
        message: `[${this.metadata.name}] Failed to update auth failure metadata:`,
        error: metaError as Error,
      });
    }
  }

  /**
   * Reset the consecutive auth-failure counter after a successful call.
   * Failures here are swallowed because the recorded count is non-critical:
   * we'd rather risk an extra deactivation than fail a working request.
   */
  protected async resetAuthFailures(connectionId: string): Promise<void> {
    try {
      const connection = await this.getConnection(connectionId);
      // New object reference so Sequelize persists the reset (see handleAuthError).
      const metadata: AuthTrackingMetadata = { ...(connection.metadata as AuthTrackingMetadata) };

      if (metadata.consecutiveAuthFailures && metadata.consecutiveAuthFailures > 0) {
        metadata.consecutiveAuthFailures = 0;
        connection.metadata = metadata as any;
        // Commit outside any ambient sync transaction (see handleAuthError).
        await connection.save({ transaction: null });
      }
    } catch {
      // Non-critical, ignore
    }
  }

  /**
   * Validate that a connection belongs to the correct provider type
   * @param connection - Connection to validate
   * @throws Error if provider type mismatch
   */
  protected validateProviderType(connection: BankDataProviderConnections): void {
    if (connection.providerType !== this.metadata.type) {
      throw new Error(
        t({
          key: 'errors.providerTypeMismatch',
          variables: {
            connectionId: connection.id,
            actualType: connection.providerType,
            expectedType: this.metadata.type,
          },
        }),
      );
    }
  }

  // ============================================================================
  // Sync Lifecycle Scaffolding
  // ============================================================================

  /**
   * Abort an inline sync mid-run if a base-currency recalculation holds the
   * user's lock. Called at row-batch boundaries inside the per-row persist loops
   * (every ~25 createTransaction calls) so a sync that started just before the
   * lock landed stops committing old-base rows past the recalc's snapshot.
   * Throws {@link BaseCurrencyChangeLockedError}, which runSyncWithStatus turns
   * into a terminal FAILED status.
   */
  protected async abortSyncIfBaseCurrencyChangeLocked({ userId }: { userId: number }): Promise<void> {
    if (await isBaseCurrencyChangeLocked({ userId })) {
      throw new BaseCurrencyChangeLockedError();
    }
  }

  /**
   * Returns a checkpoint to call once per row inside a persist loop. It bails out
   * the moment a base-currency change takes the lock, so rows stop landing against
   * the old base past the recalc's snapshot. The lock is only read every 25 rows to
   * bound the Redis GET; the returned closure owns that counter.
   */
  protected createBaseCurrencyLockCheckpoint({ userId }: { userId: number }): () => Promise<void> {
    let processedInLoop = 0;
    return async () => {
      if (processedInLoop % 25 === 0) {
        await this.abortSyncIfBaseCurrencyChangeLocked({ userId });
      }
      processedInLoop += 1;
    };
  }

  /**
   * Wrap a provider's inline sync work with the shared status lifecycle:
   * SYNCING → work → updateLastSync → auto-link transfers → emit event →
   * COMPLETED. On error, log via `errorLogMessage`, record FAILED with the error
   * message, then rethrow.
   *
   * `work` must return an object containing `transactionIds` — the ids created
   * during persistence — so the emit event can carry them. `extraAutoLinkCandidateIds`
   * widens the auto-link scope with already-stored rows the sync made linkable (a pending
   * row upgraded to booked) without emitting them. Any extra fields on the result are
   * passed through to the caller untouched.
   *
   * Providers whose upstream uses a job queue (Monobank) should use
   * {@link runQueuedSync} instead — the worker, not this helper, owns the
   * SYNCING → COMPLETED transition there.
   */
  protected async runSyncWithStatus<T extends { transactionIds: string[]; extraAutoLinkCandidateIds?: string[] }>({
    systemAccountId,
    userId,
    connectionId,
    errorLogMessage,
    work,
  }: {
    systemAccountId: RecordId;
    userId: number;
    connectionId: string;
    errorLogMessage: string;
    work: () => Promise<T>;
  }): Promise<T> {
    await setAccountSyncStatus({ accountId: systemAccountId, status: SyncStatus.SYNCING, userId });

    try {
      const result = await work();

      await this.updateLastSync(connectionId);

      await linkAndEmitSyncedTransactions({
        userId,
        accountId: systemAccountId,
        transactionIds: result.transactionIds,
        extraAutoLinkCandidateIds: result.extraAutoLinkCandidateIds,
      });

      await setAccountSyncStatus({ accountId: systemAccountId, status: SyncStatus.COMPLETED, userId });

      return result;
    } catch (error) {
      if (error instanceof ServiceUnavailableError) {
        // An unreachable bank provider is an expected outage, so it stays out of Sentry.
        logger.info('[Bank Sync] Bank provider unavailable, sync skipped', {
          accountId: systemAccountId,
          connectionId,
          reason: error.message,
        });
      } else if (isDeadlockError(error)) {
        // Propagates to syncTransactionsForAccount, which retries it; a failed retry is reported upstream.
        logger.info('[Bank Sync] Sync deadlocked with a concurrent sync', { accountId: systemAccountId, connectionId });
      } else {
        logger.error({ message: errorLogMessage, error: error as Error });
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      await setAccountSyncStatus({
        accountId: systemAccountId,
        status: SyncStatus.FAILED,
        error: message,
        userId,
      });
      throw error;
    }
  }

  /**
   * Variant of {@link runSyncWithStatus} for providers whose sync hands work
   * off to a job queue (Monobank → BullMQ). Marks the account QUEUED, runs the
   * `enqueue` callback (which returns the queue's job descriptor), and returns
   * it. On error, records FAILED with the error message and rethrows.
   *
   * Critically, this helper NEVER touches SYNCING or COMPLETED — those are the
   * worker's responsibility. Calling it on an inline-sync provider would leave
   * the account stuck in QUEUED.
   */
  protected async runQueuedSync<T>({
    systemAccountId,
    userId,
    errorLogMessage,
    enqueue,
  }: {
    systemAccountId: RecordId;
    userId: number;
    errorLogMessage?: string;
    enqueue: () => Promise<T>;
  }): Promise<T> {
    await setAccountSyncStatus({ accountId: systemAccountId, status: SyncStatus.QUEUED, userId });

    try {
      return await enqueue();
    } catch (error) {
      // Just in case, catch any errors that happened before and during queueing
      // Everything that happens inside workers is handled by workers
      if (errorLogMessage) {
        logger.error({ message: errorLogMessage, error: error as Error });
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      await setAccountSyncStatus({
        accountId: systemAccountId,
        status: SyncStatus.FAILED,
        error: message,
        userId,
      });
      throw error;
    }
  }

  // ============================================================================
  // Abstract Methods - Must be implemented by child classes
  // ============================================================================

  /**
   * Create a new connection to this provider for a user
   * @param userId - User creating the connection
   * @param credentials - Provider-specific credentials
   * @returns Connection ID
   */
  abstract connect(userId: number, credentials: unknown): Promise<string>;

  /**
   * Disconnect and remove a provider connection
   * @param connectionId - Connection to disconnect
   */
  abstract disconnect(connectionId: string): Promise<void>;

  /**
   * Validate credentials by testing connection to provider
   * @param credentials - Credentials to validate
   * @returns True if credentials are valid
   */
  abstract validateCredentials(credentials: unknown): Promise<boolean>;

  /**
   * Update credentials for an existing connection
   * @param connectionId - Connection to update
   * @param newCredentials - New credentials to store
   */
  abstract refreshCredentials(connectionId: string, newCredentials: unknown): Promise<void>;

  /**
   * Fetch list of accounts from provider (without saving to DB)
   * @param connectionId - Connection to fetch accounts from
   * @returns List of provider accounts
   */
  abstract fetchAccounts(connectionId: string): Promise<ProviderAccount[]>;

  /**
   * Fetch transactions for a specific account (without saving to DB)
   * @param connectionId - Connection ID
   * @param accountExternalId - Provider's account ID
   * @param dateRange - Optional date range to filter transactions
   * @returns List of transactions
   */
  abstract fetchTransactions(
    connectionId: string,
    accountExternalId: string,
    dateRange?: DateRange,
  ): Promise<ProviderTransaction[]>;

  /**
   * Sync transactions for a specific account to our database
   * @param connectionId - Connection ID
   * @param systemAccountId - Our internal account ID
   * @param userId - User ID for SSE notifications
   * @returns Either void (immediate sync) or job info (queue-based sync)
   */
  abstract syncTransactions({
    connectionId,
    systemAccountId,
    userId,
  }: {
    connectionId: string;
    systemAccountId: string;
    userId: number;
  }): Promise<void | { jobGroupId: string; totalBatches: number; estimatedMinutes: number }>;

  /**
   * Fetch current balance for a specific account
   * @param connectionId - Connection ID
   * @param accountExternalId - Provider's account ID
   * @returns Current balance
   */
  abstract fetchBalance(connectionId: string, accountExternalId: string): Promise<ProviderBalance>;

  /**
   * Refresh balance for a specific account in our system
   * @param connectionId - Connection ID
   * @param systemAccountId - Our internal account ID
   */
  abstract refreshBalance(connectionId: string, systemAccountId: string): Promise<void>;

  /**
   * Set up webhook for real-time updates (if supported)
   * Optional method - only implement if provider supports webhooks
   * @param connectionId - Connection to set up webhook for
   * @param webhookUrl - URL to receive webhook notifications
   */
  setupWebhook?(connectionId: string, webhookUrl: string): Promise<void>;

  /**
   * Handle incoming webhook payload (if supported)
   * Optional method - only implement if provider supports webhooks
   * @param payload - Webhook payload from provider
   */
  handleWebhook?(payload: unknown): Promise<void>;

  /**
   * Load transactions for an explicit historical window (the account-details
   * "load data for period" picker). Optional — only providers that support
   * date-range historical loads implement it.
   */
  loadTransactionsForPeriod?(args: {
    connectionId: string;
    systemAccountId: string;
    userId: number;
    from: Date;
    to: Date;
  }): Promise<LoadTransactionsForPeriodResult>;

  /**
   * Sync several accounts of one connection in a single batched pass (optional).
   * Implemented only by providers whose upstream returns every account (with
   * transactions) in one response — e.g. SimpleFIN's `/accounts` — so the
   * orchestrators can fetch once per window instead of once per account.
   * Marks each account's sync status internally.
   */
  syncConnectionAccounts?(args: { connectionId: string; userId: number; systemAccountIds: string[] }): Promise<void>;
}
