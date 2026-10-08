import type { EntityLogoFields, EntityLogoPayload } from './entity-logo';
import type { RecordId } from './record-id';
import type { ResourceShareInfo } from './sharing';

export enum ACCOUNT_TYPES {
  system = 'system',
  monobank = 'monobank', // monobank provider connection
  enableBanking = 'enable-banking', // enable-banking provider connection
  lunchflow = 'lunchflow', // lunchflow provider connection
  walutomat = 'walutomat', // walutomat provider connection
  simplefin = 'simplefin', // SimpleFIN Bridge provider connection
}

/**
 * Supported bank data provider types
 */
export enum BANK_PROVIDER_TYPE {
  MONOBANK = 'monobank',
  ENABLE_BANKING = 'enable-banking',
  LUNCHFLOW = 'lunchflow',
  WALUTOMAT = 'walutomat',
  SIMPLEFIN = 'simplefin',
}

/**
 * Why a bank-data-provider connection was deactivated. Stored on
 * `BankDataProviderConnections.metadata.deactivationReason`. Drives the
 * "needs reauth" UI surfacing – only `AUTH_FAILURE` deactivations are
 * shown to the user, manual disconnects stay hidden.
 *
 * `RESTORED` marks a connection that came in through a data-backup restore:
 * its encrypted credentials were undecryptable on this instance and were
 * replaced with an empty stub, so the connection is honestly broken and the
 * user must reconnect before it can sync again.
 */
export const DEACTIVATION_REASON = {
  AUTH_FAILURE: 'auth_failure',
  RESTORED: 'restored',
} as const;

export type DeactivationReason = (typeof DEACTIVATION_REASON)[keyof typeof DEACTIVATION_REASON];

export enum ACCOUNT_STATUSES {
  active = 'active',
  archived = 'archived',
}

export enum ACCOUNT_CATEGORIES {
  general = 'general',
  cash = 'cash',
  currentAccount = 'current-account',
  creditCard = 'credit-card',
  saving = 'saving',
  bonus = 'bonus',
  insurance = 'insurance',
  investment = 'investment',
  loan = 'loan',
  overdraft = 'overdraft',
  crypto = 'crypto',
  vehicle = 'vehicle',
}

/**
 * Account categories that own a required 1:1 sidecar row (LoanDetails,
 * Vehicles) and a dedicated creation flow (`/loans`, `/vehicles`). They must
 * never be created through the generic `POST /accounts` path — that would
 * produce a sidecar-less account with none of the managed-balance machinery,
 * so the create service rejects them and the create-account UI hides them.
 * Each is created only via its own endpoint, which writes the account and its
 * sidecar in one transaction.
 *
 * Their balance history belongs to the same dedicated flow (loan projection,
 * depreciation curve) rather than to `initialBalance + Σtransactions`, so the
 * balance-revalue paths skip them too.
 */
export const DEDICATED_FLOW_ACCOUNT_CATEGORIES = [ACCOUNT_CATEGORIES.loan, ACCOUNT_CATEGORIES.vehicle] as const;

type DedicatedFlowAccountCategory = (typeof DEDICATED_FLOW_ACCOUNT_CATEGORIES)[number];

export const isDedicatedFlowAccountCategory = (
  category: ACCOUNT_CATEGORIES,
): category is DedicatedFlowAccountCategory =>
  DEDICATED_FLOW_ACCOUNT_CATEGORIES.includes(category as DedicatedFlowAccountCategory);

/** Where linking puts the balance residual the post-link sync leaves unexplained. */
export const LINK_RESIDUAL_TARGETS = ['opening-balance', 'adjustment'] as const;
export type LinkResidualTarget = (typeof LINK_RESIDUAL_TARGETS)[number];

/**
 * Known structure for account externalData field.
 * This is a JSONB field that can contain additional custom data.
 */
export interface AccountExternalData {
  /** Bank connection linking metadata (for linked system accounts) */
  bankConnection?: {
    linkedAt: string; // ISO date string
    linkingStrategy: 'forward-only' | 'full-reconciliation';
    balanceReconciliation: {
      systemBalance: number;
      externalBalance: number;
      difference: number;
      adjustmentTransactionId: RecordId | null;
      /** Where the post-link residual goes. Absent means the opening-balance path. */
      residualTarget?: LinkResidualTarget;
      /** Residual the post-link sync left unexplained, in cents, folded into the opening balance. */
      absorbedResidual?: number;
      /**
       * Set at link time for queue-synced providers, whose residual cannot be
       * measured until the worker persists the sync. The queue's completion
       * path runs the deferred absorb and clears this.
       */
      pendingAbsorb?: boolean;
    };
  };
  // Allow any additional custom fields
  [key: string]: unknown;
}

export interface AccountModel extends EntityLogoFields {
  type: ACCOUNT_TYPES;
  id: RecordId;
  name: string;
  initialBalance: number;
  refInitialBalance: number;
  currentBalance: number;
  refCurrentBalance: number;
  creditLimit: number;
  refCreditLimit: number;
  accountCategory: ACCOUNT_CATEGORIES;
  currencyCode: string;
  userId: number;
  externalId?: RecordId;
  status: ACCOUNT_STATUSES;
  excludeFromStats: boolean;
  bankDataProviderConnectionId?: RecordId;
  /**
   * Provider type denormalized from the connection so the account list / card can render
   * the bank logo without a per-account `GET /connections/:id` round-trip. Safe to expose
   * to share recipients (who can't reach the owner-scoped connection-details endpoint).
   */
  bankProviderType?: BANK_PROVIDER_TYPE | null;
  /** Present on user-facing list/detail responses; absent on internal serializations. */
  share?: ResourceShareInfo;
}

/**
 * Serialized account wire shape (DB → API): every monetary field is a decimal
 * (cents converted on the way out), `id`/`type`/`accountCategory` are plain
 * strings, and owner-only bank-link metadata is stripped for share recipients.
 * The single source of truth for both the backend serializer's return type and
 * the frontend loan/account response shapes, so the two can't drift.
 */
export interface AccountApiResponse extends EntityLogoFields {
  id: string;
  name: string;
  initialBalance: number;
  refInitialBalance: number;
  currentBalance: number;
  refCurrentBalance: number;
  creditLimit: number;
  refCreditLimit: number;
  type: string;
  accountCategory: string;
  currencyCode: string;
  userId: number;
  externalId: string | null;
  status: ACCOUNT_STATUSES;
  excludeFromStats: boolean;
  bankDataProviderConnectionId: string | null;
  /** Provider type denormalized from the connection so the frontend can render the
   *  bank logo without a per-account connection-details lookup (which is owner-scoped
   *  and unreachable for share recipients). */
  bankProviderType: BANK_PROVIDER_TYPE | null;
  needsRelink?: boolean;
  /** Present on user-facing list/detail responses; absent on internal serializations. */
  share?: ResourceShareInfo;
}

/**
 * Serialized account-group wire shape (DB → API), with nested accounts already
 * serialized and child groups nested the same way. The single source of truth
 * for both the backend serializer's return type and the frontend group type, so
 * the two can't drift.
 */
export interface AccountGroupApiResponse extends EntityLogoFields {
  id: string;
  name: string;
  userId: number;
  parentGroupId: string | null;
  bankDataProviderConnectionId: string | null;
  accounts: AccountApiResponse[];
  childGroups: AccountGroupApiResponse[];
}

/**
 * Account model with computed `needsRelink` flag.
 * Used in API responses where the backend computes whether an Enable Banking
 * account needs to be re-linked due to schema migration (externalId was uid,
 * now should be identification_hash).
 */
export interface AccountWithRelinkStatus extends AccountModel {
  needsRelink: boolean;
}

export interface BalanceModel {
  id: RecordId;
  date: Date;
  amount: number;
  accountId: RecordId;
  account: Omit<AccountModel, 'systemType'>;
}

/** Index signature for bodies whose keys accept an explicit `null` (clear the
 *  stored value) alongside "absent = leave alone". Opt-in per body,
 *  so nulls stay rejected on every other endpoint body. */
type NullableBodyPayload = {
  [key: string | number]: string | number | boolean | null | undefined;
};

export interface CreateAccountBody extends NullableBodyPayload, EntityLogoPayload {
  accountCategory: AccountModel['accountCategory'];
  currencyCode: AccountModel['currencyCode'];
  name: AccountModel['name'];
  initialBalance: AccountModel['initialBalance'];
  creditLimit: AccountModel['creditLimit'];
  type?: AccountModel['type'];
}

export interface UpdateAccountBody extends NullableBodyPayload, EntityLogoPayload {
  accountCategory?: AccountModel['accountCategory'];
  name?: AccountModel['name'];
  currentBalance?: AccountModel['currentBalance'];
  initialBalance?: AccountModel['initialBalance'];
  creditLimit?: AccountModel['creditLimit'];
  status?: ACCOUNT_STATUSES;
  excludeFromStats?: boolean;
}
