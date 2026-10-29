/**
 * Akahu-specific types for the provider implementation.
 * Akahu API returns monetary amounts as signed decimals (not cents):
 * negative = money left the account (debit), positive = money entered (credit).
 * Docs: https://developers.akahu.nz/
 */
import type { Decimal, DeactivationReason } from '@bt/shared/types';

/**
 * Akahu personal-app credentials: the two static tokens shown on
 * my.akahu.nz/apps. Sent as `Authorization: Bearer <userToken>` and
 * `X-Akahu-Id: <appToken>` headers on every request.
 */
export interface AkahuCredentials {
  userToken: string;
  appToken: string;
}

/**
 * Akahu connection metadata stored alongside credentials
 */
export interface AkahuMetadata {
  accountCount?: number;
  consecutiveAuthFailures?: number;
  deactivationReason?: DeactivationReason | null;
}

export type AkahuAccountStatus = 'ACTIVE' | 'INACTIVE';

export type AkahuAccountType =
  | 'CHECKING'
  | 'SAVINGS'
  | 'CREDITCARD'
  | 'LOAN'
  | 'KIWISAVER'
  | 'INVESTMENT'
  | 'TERMDEPOSIT'
  | 'FOREIGN'
  | 'TAX'
  | 'REWARDS'
  | 'WALLET';

export type AkahuAccountAttribute = 'TRANSACTIONS' | 'TRANSFER_TO' | 'TRANSFER_FROM' | 'PAYMENT_TO' | 'PAYMENT_FROM';

export interface AkahuApiBalance {
  available: Decimal | null;
  current: Decimal | null;
  currency: string;
  limit?: Decimal | null;
  overdrawn?: boolean;
}

export interface AkahuApiConnection {
  _id: string;
  name: string;
  logo?: string | null;
}

export interface AkahuApiAccount {
  _id: string;
  name: string;
  type: AkahuAccountType;
  status: AkahuAccountStatus;
  balance: AkahuApiBalance;
  attributes?: AkahuAccountAttribute[];
  connection?: AkahuApiConnection | null;
  formatted_account?: string | null;
  meta?: { holder?: string | null } | null;
  refreshed?: {
    balance?: string | null;
    transactions?: string | null;
  } | null;
}

export interface AkahuApiAccountsResponse {
  success: boolean;
  items: AkahuApiAccount[];
}

export interface AkahuApiAccountResponse {
  success: boolean;
  item: AkahuApiAccount;
}

export interface AkahuApiMerchant {
  _id?: string;
  name: string;
  website?: string | null;
}

export interface AkahuApiCategory {
  _id?: string;
  name: string;
  groups?: Record<string, { _id?: string; name?: string }>;
}

export interface AkahuApiTransactionMeta {
  particulars?: string | null;
  code?: string | null;
  reference?: string | null;
  other_account?: string | null;
  card_suffix?: string | null;
  logo?: string | null;
  conversion?: { amount: Decimal; currency: string; rate: number } | null;
}

export interface AkahuApiTransaction {
  _id: string;
  _account: string;
  _connection?: string;
  created_at?: string;
  updated_at?: string;
  /** ISO 8601, UTC. Day-accurate for most institutions. */
  date: string;
  description: string;
  /** Signed decimal: negative = expense, positive = income. */
  amount: Decimal;
  balance?: Decimal | null;
  type: string;
  merchant?: AkahuApiMerchant | null;
  category?: AkahuApiCategory | null;
  meta?: AkahuApiTransactionMeta | null;
}

export interface AkahuApiTransactionsResponse {
  success: boolean;
  items: AkahuApiTransaction[];
  cursor?: { next: string | null } | null;
}

export interface AkahuApiMe {
  success: boolean;
  item: {
    _id: string;
    email?: string;
    access_granted_at?: string | null;
  };
}
