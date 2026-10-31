import type { DeactivationReason } from '@bt/shared/types';

/** The user's own YAXI key, as pasted into MoneyMatter. */
export interface YaxiKey {
  keyId: string;
  /** Base64 HMAC secret. */
  secret: string;
}

export interface YaxiCredentials extends YaxiKey {
  /** Base64 opaque connection data from the browser login; absent until the first login completes. */
  connectionData?: string;
}

export interface YaxiMetadata {
  expectedTicketId?: string | null;
  bankConnectionId?: string;
  bankName?: string;
  logoId?: string | null;
  accountCount?: number;
  consecutiveAuthFailures?: number;
  deactivationReason?: DeactivationReason | null;
}

/** Read services only: payment services must stay impossible to request. */
export type YaxiReadService = 'Accounts' | 'Balances' | 'Transactions';
