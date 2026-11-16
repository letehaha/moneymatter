/**
 * Core types and interfaces for the Bank Data Provider system.
 * This system allows users to connect multiple bank accounts from various providers
 * (Monobank, Enable Banking, etc.) in a unified, modular way.
 */
import { ACCOUNT_TYPES, BANK_PROVIDER_TYPE, Cents, type DeactivationReason } from '@bt/shared/types';

/**
 * Connection-metadata fields used by the shared auth-failure tracking in
 * BaseBankDataProvider. Provider metadata interfaces extend this.
 */
export interface AuthTrackingMetadata {
  consecutiveAuthFailures?: number;
  deactivationReason?: DeactivationReason | null;
}

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

export const PROVIDER_TO_ACCOUNT_TYPE: Record<BANK_PROVIDER_TYPE, ACCOUNT_TYPES> = {
  [BANK_PROVIDER_TYPE.MONOBANK]: ACCOUNT_TYPES.monobank,
  [BANK_PROVIDER_TYPE.ENABLE_BANKING]: ACCOUNT_TYPES.enableBanking,
  [BANK_PROVIDER_TYPE.LUNCHFLOW]: ACCOUNT_TYPES.lunchflow,
  [BANK_PROVIDER_TYPE.WALUTOMAT]: ACCOUNT_TYPES.walutomat,
  [BANK_PROVIDER_TYPE.SIMPLEFIN]: ACCOUNT_TYPES.simplefin,
  [BANK_PROVIDER_TYPE.AKAHU]: ACCOUNT_TYPES.akahu,
};

// ============================================================================
// Provider Data Types
// ============================================================================

/**
 * Bank account from external provider
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

export interface SyncedTransactionRow {
  originalId: string;
  time: Date;
  /**
   * Signed decimal as the provider reports it; negative is an expense. A string is accepted so
   * SimpleFIN's decimal is parsed strictly by `Money.fromDecimal`, and only after dedup.
   */
  amount: number | string;
  note: string;
  externalData: Record<string, unknown>;
  rawMerchantName?: string | null;
  externalReference?: string | null;
}

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
