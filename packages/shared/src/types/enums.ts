/**
 * User roles for access control and feature gating.
 * - admin: Full access to all features including admin panel
 * - common: Regular registered user
 * - demo: Temporary demo user (auto-deleted after 4 hours)
 */
export const USER_ROLES = {
  admin: 'admin',
  common: 'common',
  demo: 'demo',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

/**
 * Supported OAuth providers for authentication
 */
export enum OAUTH_PROVIDER {
  google = 'google',
  github = 'github',
}

// Array of all providers for iteration (e.g., trustedProviders config)
export const OAUTH_PROVIDERS_LIST = Object.values(OAUTH_PROVIDER);

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

/**
 * Identifies the exchange rate provider that supplied a given rate.
 * Persisted as the free-form `VARCHAR` `source` column on the `ExchangeRates`
 * table. This enum is the SOLE source of truth for valid values — so adding a
 * provider is a code-only change with no migration.
 */
export enum EXCHANGE_RATE_PROVIDER_TYPE {
  CURRENCY_RATES_API = 'currency-rates-api',
  FAWAZ_CURRENCY_API = 'fawaz-currency-api',
  API_LAYER = 'api-layer',
  /**
   * Catch-all for rows whose origin cannot be determined.
   * Used as the DB default – never set explicitly by a provider.
   */
  UNKNOWN = 'unknown',
}

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

/**
 * Vehicle body / drivetrain class used to pick the default depreciation curve.
 * VARCHAR in DB, TS-side enum for type safety (per project's no-DB-enums rule).
 */
export enum VEHICLE_CLASS {
  sedan = 'sedan',
  suv = 'suv',
  truck = 'truck',
  luxury = 'luxury',
  ev = 'ev',
  motorcycle = 'motorcycle',
  other = 'other',
}

/**
 * How a vehicle's depreciation is parameterized:
 * - classDefault: use the per-class default curve as-is.
 * - slow / average / fast: scale the per-class default curve by a preset multiplier.
 * - custom: ignore class curve, apply a single flat annual rate (customAnnualRatePct).
 */
export enum DEPRECIATION_PRESET {
  classDefault = 'class-default',
  slow = 'slow',
  average = 'average',
  fast = 'fast',
  custom = 'custom',
}

export enum PAYMENT_TYPES {
  bankTransfer = 'bankTransfer',
  voucher = 'voucher',
  webPayment = 'webPayment',
  cash = 'cash',
  mobilePayment = 'mobilePayment',
  creditCard = 'creditCard',
  debitCard = 'debitCard',
}

export enum SORT_DIRECTIONS {
  asc = 'ASC',
  desc = 'DESC',
}

/**
 * Sortable fields for the transactions list. Name-based fields sort by the
 * related record's name (resolved backend-side via subquery), not by id.
 */
export enum TRANSACTION_SORT_FIELD {
  time = 'time',
  refAmount = 'refAmount',
  accountName = 'accountName',
  categoryName = 'categoryName',
  payeeName = 'payeeName',
  note = 'note',
  categorizationSource = 'categorizationSource',
}

export enum TRANSACTION_TYPES {
  income = 'income',
  expense = 'expense',
}

export enum CATEGORY_TYPES {
  custom = 'custom',
  // internal means that it cannot be deleted or edited
  internal = 'internal',
}

/** Pseudo-id accepted alongside real ids in `payeeIds` / `tagIds` list filters:
 * matches rows where the field is not set. */
export const BLANK_FILTER_VALUE = 'blank';

export enum FILTER_OPERATION {
  all = 'all',
  exclude = 'exclude',
  only = 'only',
}

// Stored like that in the DB as well
export enum TRANSACTION_TRANSFER_NATURE {
  not_transfer = 'not_transfer',
  common_transfer = 'transfer_between_user_accounts',
  transfer_out_wallet = 'transfer_out_wallet',
  transfer_to_portfolio = 'transfer_to_portfolio',
  transfer_to_venture = 'transfer_to_venture',
  transfer_to_loan = 'transfer_to_loan',
}

/**
 * Loan sub-type on `LoanDetails.loanType` — UI grouping/badges only, no impact
 * on amortization or balance handling. VARCHAR in the DB (no-DB-enums rule).
 */
export enum LOAN_TYPE {
  mortgage = 'mortgage',
  auto = 'auto',
  student = 'student',
  personal = 'personal',
  heloc = 'heloc',
  business = 'business',
  medical = 'medical',
  other = 'other',
}

/** Subset of `LOAN_TYPE` the form picker exposes; HELOC-style types need multi-disbursement support first. */
export const SUPPORTED_LOAN_TYPES = [
  LOAN_TYPE.mortgage,
  LOAN_TYPE.auto,
  LOAN_TYPE.student,
  LOAN_TYPE.personal,
] as const;

export enum BUDGET_STATUSES {
  active = 'active',
  closed = 'closed',
  archived = 'archived',
}

export enum BUDGET_TYPES {
  manual = 'manual',
  category = 'category',
}

/**
 * Tag reminder trigger types
 */
export const TAG_REMINDER_TYPES = {
  amountThreshold: 'amount_threshold',
  existenceCheck: 'existence_check',
} as const;

export type TagReminderType = (typeof TAG_REMINDER_TYPES)[keyof typeof TAG_REMINDER_TYPES];

/**
 * Tag reminder frequency presets
 */
export const TAG_REMINDER_FREQUENCIES = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearly: 'yearly',
} as const;

export type TagReminderFrequency = (typeof TAG_REMINDER_FREQUENCIES)[keyof typeof TAG_REMINDER_FREQUENCIES];

/**
 * Special value for real-time/immediate reminders (no scheduled frequency).
 * Used in frontend forms to represent `null` frequency.
 */
export const TAG_REMINDER_IMMEDIATE = 'immediate' as const;

export type TagReminderFrequencyOrImmediate = TagReminderFrequency | typeof TAG_REMINDER_IMMEDIATE;

/**
 * Source of transaction categorization
 */
export enum CATEGORIZATION_SOURCE {
  manual = 'manual',
  ai = 'ai',
  mccRule = 'mcc_rule',
  userRule = 'user_rule',
  subscriptionRule = 'subscription_rule',
  payeeRule = 'payee_rule',
}

/** What started an AI categorization run, as opposed to what categorized a row (`CATEGORIZATION_SOURCE`). */
export enum CATEGORIZATION_TRIGGER {
  manual = 'manual',
  import = 'import',
  sync = 'sync',
}

/**
 * Why the AI declined to pick a category for a row it was shown. The row still gets the
 * run's stamp so it leaves the candidate pool, but its category stays untouched.
 */
export enum CATEGORIZATION_SKIP_REASON {
  /** Money moved between accounts or people (P2P), not a purchase. */
  transfer = 'transfer',
  /** Not enough information in the row to decide. */
  unclear = 'unclear',
  /** None of the offered categories applies. */
  no_fit = 'no_fit',
  /** The model returned no verdict for the row at all (e.g. answered in prose). */
  unspecified = 'unspecified',
}

/**
 * How aggressively a Payee's `defaultCategoryId` overrides other categorization
 * sources.
 *
 * - `enforce`: `payee_rule` always wins – sets `categoryId` AND stamps
 *   `categorizationMeta.source = payee_rule`, so AI then skips the row via its
 *   "categorizationMeta IS NULL" filter. Good for narrow merchants where every
 *   transaction is clearly the same category (Spotify → Subscriptions).
 * - `hint`: `payee_rule` fills `categoryId` but leaves
 *   `categorizationMeta = null`. AI still runs and can pick a better category
 *   from the transaction description. Good for catch-all merchants where the
 *   default category is a reasonable fallback but per-tx context matters
 *   (Amazon → "iPhone" vs "Garden tool").
 * - `off`: `payee_rule` does NOT apply at all. The Payee is still linked, but
 *   `categoryId` and `categorizationMeta` are left untouched so AI starts from
 *   scratch.
 */
export enum CATEGORIZATION_MODE {
  enforce = 'enforce',
  hint = 'hint',
  off = 'off',
}

/**
 * How an entity's logoDomain was resolved, on the write-only paths that always
 * set a concrete source. 'auto' = matched by the brand resolver against
 * BrandLogos; 'manual' = explicitly set by the user. Shared by every entity that
 * carries a denormalized brand logo (payees, subscriptions). VARCHAR column – no
 * DB enum (project convention).
 */
export type LogoSource = 'auto' | 'manual';

/**
 * Persisted three-state of an entity's logo resolution:
 * - `'auto'`: the brand resolver matched (or negative-resolved) this entity.
 * - `'manual'`: the user set the logo explicitly; the resolver treats it as authoritative.
 * - `null`: unresolved – the entity has never been through a resolution pass.
 *
 * This is the column type. `LogoSource` is the narrower write-only type for code
 * paths that always stamp a concrete source.
 */
export type LogoResolutionState = LogoSource | null;

/**
 * Supported AI providers for features like transaction categorization.
 *
 * `custom` is any OpenAI-compatible endpoint (OpenRouter, Ollama, a proxy).
 */
export enum AI_PROVIDER {
  anthropic = 'anthropic',
  openai = 'openai',
  google = 'google',
  custom = 'custom',
}

/**
 * AI-powered features that can have individual model configurations
 */
export enum AI_FEATURE {
  categorization = 'categorization',
  statementParsing = 'statement_parsing',
  investmentTransactionsParsing = 'investment_transactions_parsing',
  receiptParsing = 'receipt_parsing',
  // Future features:
  // insights = 'insights',
  // budgetSuggestions = 'budget_suggestions',
}

/**
 * Known notification types. Using string literals (not enum) to allow
 * adding new types without migrations. These are the currently supported types.
 */
export const NOTIFICATION_TYPES = {
  budgetAlert: 'budget_alert',
  system: 'system',
  changelog: 'changelog',
  tagReminder: 'tag_reminder',
  subscriptionReminder: 'subscription_reminder',
  /** A bank sync confirmed N planned transactions by merging real rows into them. */
  plannedConfirmed: 'planned_confirmed',
  /** Enable Banking rows still pending after a week; the user should check them with the bank. */
  stuckPending: 'stuck_pending',
  shareInvitationReceived: 'share_invitation_received',
  shareInvitationSendFailed: 'share_invitation_send_failed',
  shareAccepted: 'share_accepted',
  shareDeclined: 'share_declined',
  shareRevoked: 'share_revoked',
  shareLeft: 'share_left',
  shareExpired: 'share_expired',
  shareOwnerAccountDeleted: 'share_owner_account_deleted',
  /** Recipient-side: owner deleted a budget that was shared with the recipient. Distinct
   *  from `shareRevoked` because the resource itself is gone – there's nothing to
   *  re-share, and any deep-link will 404. */
  shareOwnerBudgetDeleted: 'share_owner_budget_deleted',
  // Household membership lifecycle. Mirrors the per-resource set except for
  // the deleted-resource analog (a household has no single resource to delete)
  // and adds `householdMemberAccountDeleted` to distinguish system cascades
  // from voluntary `householdLeft`.
  householdInvitationReceived: 'household_invitation_received',
  householdInvitationSendFailed: 'household_invitation_send_failed',
  householdAccepted: 'household_accepted',
  householdDeclined: 'household_declined',
  householdPermissionChanged: 'household_permission_changed',
  householdRevoked: 'household_revoked',
  householdLeft: 'household_left',
  householdExpired: 'household_expired',
  householdOwnerAccountDeleted: 'household_owner_account_deleted',
  householdMemberAccountDeleted: 'household_member_account_deleted',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * Notification status
 */
export const NOTIFICATION_STATUSES = {
  unread: 'unread',
  read: 'read',
  dismissed: 'dismissed',
} as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[keyof typeof NOTIFICATION_STATUSES];

/**
 * Notification priority levels
 */
export const NOTIFICATION_PRIORITIES = {
  low: 'low',
  normal: 'normal',
  high: 'high',
  urgent: 'urgent',
} as const;

export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[keyof typeof NOTIFICATION_PRIORITIES];

/**
 * Subscription types
 */
export enum SUBSCRIPTION_TYPES {
  subscription = 'subscription',
  bill = 'bill',
  installment = 'installment',
}

/**
 * Subscription frequency presets
 */
export enum SUBSCRIPTION_FREQUENCIES {
  weekly = 'weekly',
  biweekly = 'biweekly',
  monthly = 'monthly',
  quarterly = 'quarterly',
  semiAnnual = 'semi_annual',
  annual = 'annual',
}

/**
 * Source of how a transaction was linked to a subscription
 */
export enum SUBSCRIPTION_MATCH_SOURCE {
  manual = 'manual',
  rule = 'rule',
  ai = 'ai',
}

/**
 * Status of a subscription–transaction link
 */
export enum SUBSCRIPTION_LINK_STATUS {
  active = 'active',
  unlinked = 'unlinked',
}

/**
 * Status of a subscription candidate (auto-detected recurring pattern)
 */
export enum SUBSCRIPTION_CANDIDATE_STATUS {
  pending = 'pending',
  accepted = 'accepted',
  dismissed = 'dismissed',
}

/**
 * Subscription period statuses.
 * Stored as VARCHAR(50) in the DB – not a Postgres ENUM.
 */
export enum SUBSCRIPTION_PERIOD_STATUSES {
  upcoming = 'upcoming',
  paid = 'paid',
  overdue = 'overdue',
  skipped = 'skipped',
}

export type SubscriptionPeriodStatus = `${SUBSCRIPTION_PERIOD_STATUSES}`;

/**
 * Fixed "remind before" presets for payment reminders.
 * Up to 3 can be selected per reminder.
 *
 * `onDueDate` (0 days) fires ON the due date itself rather than ahead of it –
 * for bills that arrive and are due the same day (e.g. an internet bill dated
 * the 4th that the user wants to be reminded about on the 4th).
 */
export const REMIND_BEFORE_PRESETS = {
  onDueDate: '0_days',
  oneDay: '1_day',
  twoDays: '2_days',
  threeDays: '3_days',
  fiveDays: '5_days',
  oneWeek: '1_week',
  twoWeeks: '2_weeks',
  oneMonth: '1_month',
} as const;

export type RemindBeforePreset = (typeof REMIND_BEFORE_PRESETS)[keyof typeof REMIND_BEFORE_PRESETS];

/** Map presets to number of days for calculation */
export const REMIND_BEFORE_DAYS: Record<RemindBeforePreset, number> = {
  '0_days': 0,
  '1_day': 1,
  '2_days': 2,
  '3_days': 3,
  '5_days': 5,
  '1_week': 7,
  '2_weeks': 14,
  '1_month': 30,
};

/** Maximum number of remind-before presets per reminder */
export const MAX_REMIND_BEFORE_PRESETS = 3;

/**
 * Resource types that can be shared with other users.
 *
 * - `account`: a single account is shared.
 * - `household`: the recipient gains access to every account owned by the
 *   grantor. A household row is stored on `ResourceShares` with
 *   `resourceId = ownerUserId::text`; the per-row CHECK constraint enforces
 *   that shape so service-layer bugs cannot poison the table.
 * - `budget`: a single budget is shared. Recipients see the budget's metadata,
 *   stats, and linked transactions in full. `write` recipients can attach /
 *   detach **their own** transactions on manual budgets only – they cannot
 *   edit budget metadata, archive, or manage other recipients (all `manage`-
 *   only). Household membership does NOT auto-grant budget access; budgets
 *   are explicit-share only.
 */
export const RESOURCE_TYPES = {
  account: 'account',
  household: 'household',
  budget: 'budget',
} as const;

export type ResourceType = (typeof RESOURCE_TYPES)[keyof typeof RESOURCE_TYPES];

/**
 * How the caller can access a shared resource. Surfaced on the per-resource
 * `share` block so the frontend can render the right label and route the user
 * to the right management UI.
 *
 * - `owner`: the caller owns the resource.
 * - `share`: a per-resource `ResourceShares` row grants access directly.
 * - `household`: access derives from a household-membership row (the grantor
 *   shared every account they own with the caller).
 * - `budget`: indirect read-only visibility – caller has an accepted budget share
 *   and the resource is a transaction attached to that budget. Confers `read` only;
 *   write paths still require an account-level share.
 */
export const ACCESS_SOURCES = {
  owner: 'owner',
  share: 'share',
  household: 'household',
  budget: 'budget',
} as const;

export type AccessSource = (typeof ACCESS_SOURCES)[keyof typeof ACCESS_SOURCES];

/**
 * AccessSource narrowed to the values that can appear on a row in the shared-with-me list
 * (i.e. the caller is a recipient, never the owner). Used by the backend list service +
 * frontend API typing so a future regression can't accidentally feed `'owner'` through.
 */
export type SharedWithMeAccessSource = Exclude<AccessSource, typeof ACCESS_SOURCES.owner>;

/**
 * Permission levels granted on a shared resource.
 * - read: view the resource and its child entities
 * - write: read + create/update/delete child entities (subject to policy)
 * - manage: write + manage other recipients of the same resource (cannot delete the resource itself)
 *
 * Household rows (`resourceType = 'household'`) reject `manage` at the DB
 * level – owner-only operations remain owner-only regardless of household
 * membership.
 */
export const SHARE_PERMISSIONS = {
  read: 'read',
  write: 'write',
  manage: 'manage',
} as const;

export type SharePermission = (typeof SHARE_PERMISSIONS)[keyof typeof SHARE_PERMISSIONS];

/**
 * Permission levels valid for household membership. Household rows reject
 * `'manage'` at the DB level (the CHECK constraint on `ResourceShares` forbids
 * it), so this narrowed type prevents callers from constructing or comparing
 * against a value that can never appear in storage.
 */
export type HouseholdSharePermission = Exclude<SharePermission, 'manage'>;

/**
 * Status of a share invitation.
 */
export const SHARE_INVITATION_STATUSES = {
  pending: 'pending',
  accepted: 'accepted',
  declined: 'declined',
  revoked: 'revoked',
  expired: 'expired',
} as const;

export type ShareInvitationStatus = (typeof SHARE_INVITATION_STATUSES)[keyof typeof SHARE_INVITATION_STATUSES];

/**
 * Scope of write access for transactions on a shared account.
 * - all: can edit/delete any transaction on the shared account
 * - own: can edit/delete only transactions the recipient created
 *
 * Stored on `ResourceShares.policy.transactionsWriteScope` when `resourceType = 'account'`.
 */
export const TRANSACTIONS_WRITE_SCOPES = {
  all: 'all',
  own: 'own',
} as const;

export type TransactionsWriteScope = (typeof TRANSACTIONS_WRITE_SCOPES)[keyof typeof TRANSACTIONS_WRITE_SCOPES];

/**
 * Hardcoded sharing-related limits. Bumping these is a code-only change.
 *
 * Accepted-recipient caps live in `SEATS_BY_PLAN` (billing.ts) and are read
 * through `getEntitlementsByUserId().seats`.
 *
 * `maxPendingInvitationsPerResource` caps how many concurrent pending invitations a
 * single owner can have for one resource. The smaller test value keeps the relevant
 * boundary cheap to exercise in e2e tests; the dev/prod value is the real abuse-prevention
 * limit (per-recipient resend rate-limiting is the dedicated spam guard).
 *
 * Backend reads this via `getMaxPendingInvitationsPerResource()` in
 * `services/sharing/limits.ts` so the test override is centralized.
 */
export const SHARING_LIMITS = {
  maxPendingInvitationsPerResource: 10,
  maxPendingInvitationsPerResourceTest: 3,
  invitationExpirationDays: 7,
  // 32 random bytes encoded as base64url → exactly 43 ASCII chars (see generate-invitation-token.ts).
  invitationTokenLength: 43,
  resendPerInviteeRateLimit: { count: 3, windowMs: 24 * 60 * 60 * 1000 },
  // Owner-wide send cap to mitigate email-bombing across many resources. The per-resource
  // pending cap and the per-invitee resend rate limit cover the within-resource case; this
  // closes the cross-resource gap.
  sendInvitationsPerOwnerPer24h: 30,
  // Tighter test value so the gate is cheap to exercise in e2e (per-owner counter is
  // per-test thanks to the Redis truncate in `beforeEach`).
  sendInvitationsPerOwnerPer24hTest: 5,
} as const;
