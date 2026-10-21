/**
 * Core types and interfaces for the Bank Data Provider system.
 * This system allows users to connect multiple bank accounts from various providers
 * (Monobank, Enable Banking, etc.) in a unified, modular way.
 */
import { BANK_PROVIDER_TYPE, Cents } from '@bt/shared/types';

// ============================================================================
// Provider Types and Enums
// ============================================================================

/**
 * Feature capabilities of a provider
 */
interface ProviderFeatures {
  /** Provider supports webhook notifications */
  supportsWebhooks: boolean;
  /** Provider supports real-time data updates */
  supportsRealtime: boolean;
  /** Provider requires periodic re-authentication */
  requiresReauth: boolean;
  /** Provider supports manual sync triggering */
  supportsManualSync: boolean;
  /** Provider supports automatic scheduled sync */
  supportsAutoSync: boolean;
  /**
   * syncTransactions only enqueues background jobs instead of persisting
   * inline. Work that needs post-sync state (balance reconciliation, residual
   * absorb) must defer to the queue's completion path.
   */
  queuedSync?: boolean;
  /** Default interval between auto-syncs (milliseconds) */
  defaultSyncInterval?: number;
  /** Minimum interval between syncs due to rate limits (milliseconds) */
  minSyncInterval?: number;
}

/**
 * Metadata describing a bank data provider
 */
export interface ProviderMetadata {
  /** Provider type identifier */
  type: BANK_PROVIDER_TYPE;
  /** Display name for UI */
  name: string;
  /** Short description of the provider */
  description: string;
  /** URL to provider logo image */
  logoUrl?: string;
  /** URL to provider documentation */
  documentationUrl?: string;
  /** Provider feature capabilities */
  features: ProviderFeatures;
  /** OAuth callback URL the user must register at the provider, when the provider needs one */
  redirectUrl?: string;
}

// ============================================================================
// Provider Data Types
// ============================================================================

/**
 * Date range for querying transactions
 */
export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Bank account from external provider.
 *
 * Every provider normalizes its amounts to integer minor units (`Cents`, 2 decimals): Monobank
 * speaks minor units natively, and the others convert their decimal amounts on the way in.
 * Sync code turns them into `Money` with `Money.fromCents`, so nothing past the provider
 * boundary handles cents as a storage format.
 */
export interface ProviderAccount {
  /** Provider's unique identifier for this account */
  externalId: string;
  /** Account name/label */
  name: string;
  /** Account type (e.g., 'debit', 'credit', 'savings') */
  type: string;
  /** Current account balance (in cents) */
  balance: Cents;
  /** Currency code (e.g., 'UAH', 'USD') */
  currency: string;
  /** Additional provider-specific data */
  metadata?: Record<string, unknown>;
}

/**
 * Transaction from external provider
 */
export interface ProviderTransaction {
  /** Provider's unique identifier for this transaction */
  externalId: string;
  /** Transaction amount in cents (positive for income, negative for expense) */
  amount: Cents;
  /** Currency code */
  currency: string;
  /** Transaction date */
  date: Date;
  /** Transaction description */
  description: string;
  /** Merchant/counterparty name */
  merchantName?: string;
  /** Transaction category (if provided by provider) */
  category?: string;
  /** Additional provider-specific data */
  metadata?: Record<string, unknown>;
}

/**
 * Account balance information from provider
 */
export interface ProviderBalance {
  /** Balance amount (in cents) */
  amount: Cents;
  /** Currency code */
  currency: string;
  /** Timestamp when balance was retrieved */
  asOf: Date;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Base interface that all bank data providers must implement.
 * This ensures a consistent API regardless of the underlying provider.
 */
/**
 * Result of a historical period load (`loadTransactionsForPeriod`).
 *
 * `jobGroupId === null` is the explicit marker that the provider loaded
 * inline and already finished: `createdCount` reports rows actually created,
 * and `fetchedCount` reports rows the provider returned for the window before
 * dedup — letting the UI distinguish "provider had no data" from "all
 * duplicates" when `createdCount` is 0. A non-null `jobGroupId` means the
 * work was queued and the caller should poll progress.
 */
export interface LoadTransactionsForPeriodResult {
  jobGroupId: string | null;
  totalBatches: number;
  estimatedMinutes: number;
  createdCount?: number;
  fetchedCount?: number;
}

export interface IBankDataProvider {
  // ========================================
  // Metadata
  // ========================================

  /** Provider metadata (name, features, credential fields, etc.) */
  readonly metadata: ProviderMetadata;

  // ========================================
  // Connection Management
  // ========================================

  /**
   * Create a new connection to this provider for a user
   * @param userId - User creating the connection
   * @param credentials - Provider-specific credentials
   * @returns Connection ID
   */
  connect(userId: number, credentials: unknown): Promise<string>;

  /**
   * Disconnect and remove a provider connection
   * @param connectionId - Connection to disconnect
   */
  disconnect(connectionId: string): Promise<void>;

  /**
   * Validate credentials by testing connection to provider
   * @param credentials - Credentials to validate
   * @returns True if credentials are valid
   */
  validateCredentials(credentials: unknown): Promise<boolean>;

  /**
   * Update credentials for an existing connection
   * @param connectionId - Connection to update
   * @param newCredentials - New credentials to store
   */
  refreshCredentials(connectionId: string, newCredentials: unknown): Promise<void>;

  // ========================================
  // Account Operations
  // ========================================

  /**
   * Fetch list of accounts from provider (without saving to DB)
   * @param connectionId - Connection to fetch accounts from
   * @returns List of provider accounts
   */
  fetchAccounts(connectionId: string): Promise<ProviderAccount[]>;

  // ========================================
  // Transaction Operations
  // ========================================

  /**
   * Fetch transactions for a specific account (without saving to DB)
   * @param connectionId - Connection ID
   * @param accountExternalId - Provider's account ID
   * @param dateRange - Optional date range to filter transactions
   * @returns List of transactions
   */
  fetchTransactions(
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
  syncTransactions({
    connectionId,
    systemAccountId,
    userId,
  }: {
    connectionId: string;
    systemAccountId: string;
    userId: number;
  }): Promise<void | { jobGroupId: string; totalBatches: number; estimatedMinutes: number }>;

  /**
   * Sync several accounts of one connection in a single batched pass (optional).
   * Only providers whose upstream returns every account (with transactions) in
   * one response — e.g. SimpleFIN's `/accounts` — implement this; it lets the
   * orchestrators fetch once per window instead of once per account, respecting
   * tight request budgets. Providers without it fall back to the per-account
   * `syncTransactions`. Marks each account's sync status internally.
   */
  syncConnectionAccounts?(args: { connectionId: string; userId: number; systemAccountIds: string[] }): Promise<void>;

  // ========================================
  // Balance Operations
  // ========================================

  /**
   * Fetch current balance for a specific account
   * @param connectionId - Connection ID
   * @param accountExternalId - Provider's account ID
   * @returns Current balance
   */
  fetchBalance(connectionId: string, accountExternalId: string): Promise<ProviderBalance>;

  /**
   * Refresh balance for a specific account in our system
   * @param connectionId - Connection ID
   * @param systemAccountId - Our internal account ID
   */
  refreshBalance(connectionId: string, systemAccountId: string): Promise<void>;

  // ========================================
  // Webhook Support (Optional)
  // ========================================

  /**
   * Set up webhook for real-time updates (if supported)
   * @param connectionId - Connection to set up webhook for
   * @param webhookUrl - URL to receive webhook notifications
   */
  setupWebhook?(connectionId: string, webhookUrl: string): Promise<void>;

  /**
   * Handle incoming webhook payload (if supported)
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
}
