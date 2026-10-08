/**
 * Server-Sent Events (SSE) shared types
 *
 * These types are used by both backend and frontend for real-time event communication.
 */
import type { BackupRestoreSseProgress } from './backup';
import type { BaseCurrencyChangeStatus } from './currencies';
import type {
  BudgetBakersWalletImportProgress,
  CsvImportProgress,
  ImportBatchDeleteProgress,
  MsMoneyImportProgress,
  OfxImportProgress,
  StatementImportProgress,
  YnabImportProgress,
} from './import-export';

/**
 * SSE Event Types - event names sent via Server-Sent Events
 */
export const SSE_EVENT_TYPES = {
  AI_CATEGORIZATION_PROGRESS: 'ai_categorization_progress',
  SYNC_STATUS_CHANGED: 'bank_connections_sync_status_changed',
  YNAB_IMPORT_PROGRESS: 'ynab_import_progress',
  BUDGET_BAKERS_WALLET_IMPORT_PROGRESS: 'budget_bakers_wallet_import_progress',
  MS_MONEY_IMPORT_PROGRESS: 'ms_money_import_progress',
  OFX_IMPORT_PROGRESS: 'ofx_import_progress',
  CSV_IMPORT_PROGRESS: 'csv_import_progress',
  BASE_CURRENCY_CHANGE_STATUS: 'base_currency_change_status',
  BACKUP_RESTORE_PROGRESS: 'backup_restore_progress',
  IMPORT_BATCH_DELETE_PROGRESS: 'import_batch_delete_progress',
  STATEMENT_IMPORT_PROGRESS: 'statement_import_progress',
} as const;

export type SSEEventType = (typeof SSE_EVENT_TYPES)[keyof typeof SSE_EVENT_TYPES];

/**
 * Payload for AI_CATEGORIZATION_PROGRESS event
 * Sent during categorization to track progress
 */
export interface AiCategorizationProgressPayload {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  processedCount: number;
  totalCount: number;
  failedCount: number;
  /**
   * Rows the AI saw but declined to categorize; they count into `processedCount`, not
   * `failedCount`. Optional: statuses recorded before skips existed carry no field.
   */
  skippedCount?: number;
  /** Why transactions failed, when the run itself knows (e.g. the user's AI endpoint is down). */
  errorMessage?: string;
}

/**
 * Response of GET /user/ai/categorization/status. Never 404s: "no job" is a 200
 * `idle`. A terminal status (`completed` / `failed`) is served exactly once per
 * run, so later polls report `idle` rather than repeating it.
 */
export type AiCategorizationStatus =
  | { status: 'idle' }
  | (Omit<AiCategorizationProgressPayload, 'status'> & {
      status: 'queued' | 'processing' | 'completed' | 'failed';
    });

/**
 * Account sync status for SYNC_STATUS_CHANGED event
 */
export interface SyncAccountStatus {
  accountId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  accountName: string;
  providerType: string;
}

/**
 * Bank connection that was auto-deactivated due to upstream auth failure
 * (expired session, revoked consent, invalid refresh token, etc.).
 * The user must reconnect via the integration details page to resume syncing.
 */
export interface ConnectionNeedingReauth {
  connectionId: string;
  providerType: string;
  providerName: string;
  bankName: string | null;
  accountsCount: number;
  deactivatedAt: string | null;
}

/**
 * Per-connection consent status, so the Accounts page can render Active /
 * Expiring-soon / Expired badges without fetching each connection separately.
 */
export interface ConnectionStatusSummary {
  connectionId: string;
  isActive: boolean;
  consentExpired: boolean;
  consentExpiringSoon: boolean;
  daysRemaining: number | null;
}

/**
 * Payload for SYNC_STATUS_CHANGED event
 */
export interface SyncStatusChangedPayload {
  lastSyncAt: number | null;
  accounts: SyncAccountStatus[];
  connectionsNeedingReauth: ConnectionNeedingReauth[];
  connectionStatuses: ConnectionStatusSummary[];
  summary: {
    total: number;
    syncing: number;
    queued: number;
    completed: number;
    failed: number;
    idle: number;
  };
}

/**
 * Union type for all SSE event payloads
 */
export type SSEEventPayload =
  | AiCategorizationProgressPayload
  | SyncStatusChangedPayload
  | YnabImportProgress
  | BudgetBakersWalletImportProgress
  | MsMoneyImportProgress
  | OfxImportProgress
  | CsvImportProgress
  | BaseCurrencyChangeStatus
  | BackupRestoreSseProgress
  | ImportBatchDeleteProgress
  | StatementImportProgress;

/**
 * Maps each SSE event name to the payload its listeners receive. Lets a typed
 * `on(eventType, callback)` infer the callback's payload from the event name
 * alone, so subscribers don't have to narrow the broad `SSEEventPayload` union
 * by hand. Keys are the `SSE_EVENT_TYPES` string values; every event has an
 * entry.
 */
export interface SSEEventPayloadMap {
  [SSE_EVENT_TYPES.AI_CATEGORIZATION_PROGRESS]: AiCategorizationProgressPayload;
  [SSE_EVENT_TYPES.SYNC_STATUS_CHANGED]: SyncStatusChangedPayload;
  [SSE_EVENT_TYPES.YNAB_IMPORT_PROGRESS]: YnabImportProgress;
  [SSE_EVENT_TYPES.BUDGET_BAKERS_WALLET_IMPORT_PROGRESS]: BudgetBakersWalletImportProgress;
  [SSE_EVENT_TYPES.MS_MONEY_IMPORT_PROGRESS]: MsMoneyImportProgress;
  [SSE_EVENT_TYPES.OFX_IMPORT_PROGRESS]: OfxImportProgress;
  [SSE_EVENT_TYPES.CSV_IMPORT_PROGRESS]: CsvImportProgress;
  [SSE_EVENT_TYPES.BASE_CURRENCY_CHANGE_STATUS]: BaseCurrencyChangeStatus;
  [SSE_EVENT_TYPES.BACKUP_RESTORE_PROGRESS]: BackupRestoreSseProgress;
  [SSE_EVENT_TYPES.IMPORT_BATCH_DELETE_PROGRESS]: ImportBatchDeleteProgress;
  [SSE_EVENT_TYPES.STATEMENT_IMPORT_PROGRESS]: StatementImportProgress;
}
