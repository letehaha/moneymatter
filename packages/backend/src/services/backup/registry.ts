import type { BackupReferenceFileName } from '@bt/shared/types';
import { connection } from '@models/index';
import { Model, type ModelStatic } from 'sequelize';

type AnyModel = ModelStatic<Model>;

// Models by class name, as Sequelize registered them. A misspelled name is
// caught by the load-time check at the bottom and by the drift unit test.
const models = connection.sequelize.models;

/**
 * Parent whose owned-id set scopes an indirect table's dump. Resolved once
 * per export in the scope resolver; join tables that carry no `userId` filter
 * on the parent's ids instead.
 */
export type BackupParentScope =
  | 'accounts'
  | 'categories'
  | 'payees'
  | 'portfolios'
  | 'transactions'
  | 'transactionGroups'
  | 'transactionTemplates'
  | 'budgets'
  | 'subscriptions'
  | 'ventureEvents'
  | 'subscriptionPeriods'
  | 'importBatches';

/**
 * How a table's rows are selected for the current user.
 * - `root`: the Users row itself (`where id = userId`).
 * - `userColumn`: a direct owner column (`userId` or `ownerUserId`).
 * - `viaParent`: no owner column — filter its `fk` against a parent's ids.
 */
export type BackupDumpScope =
  | { strategy: 'root' }
  | { strategy: 'userColumn'; column: 'userId' | 'ownerUserId' }
  | { strategy: 'viaParent'; fk: string; parent: BackupParentScope };

/**
 * How a table's rows are handled on restore. The export path ignores all of
 * these except `stripSecret`/`enrichMccCode`/`single`; the restore path reads them.
 * - `insert`: bulkInsert the rows verbatim.
 * - `updateUser`: UPDATE the target Users row with `fields` only.
 * - `zodSettings`: upsert through `ZodSettingsSchema.parse`, never raw JSONB.
 * - `skip`: kept in the file, not restored (counterpart users are missing).
 */
export type BackupRestoreMode = 'insert' | 'updateUser' | 'zodSettings' | 'skip';

export interface BackupTableDef<Name extends string = BackupFileName> {
  fileName: Name;
  model: AnyModel;
  /** Insert order on restore; wipe/delete runs in reverse. */
  tier: number;
  scope: BackupDumpScope;
  restoreMode: BackupRestoreMode;
  /** Emit a single object (not an array) and dump only `fields`. Users only. */
  single?: boolean;
  /** Restorable column subset for `updateUser`. */
  fields?: readonly string[];
  /** Soft-delete model — dumped with `paranoid: false` so trash travels too. */
  paranoid?: boolean;
  /** Self-referential parent column needing the two-pass restore. */
  selfRefColumn?: string;
  /** Encrypted blob to blank before writing (undecryptable on another instance). */
  stripSecret?: 'bankCredentials' | 'aiKeys';
  /** Attach the MCC's natural `code` so restore can remap the integer `mccId`. */
  enrichMccCode?: boolean;
  /** Drop a row on restore whose `currencyCode` isn't seeded on the target instance. */
  requireSeededCurrency?: boolean;
}

/**
 * Every user-owned table, dumped and (except `skip`) restored. Ordered by
 * restore tier. Money/decimal/JSONB/array columns are all dumped as their exact
 * storage values via `raw: true` — see the export service.
 */
const TABLE_DEFS = [
  // tier 1 — the Users row is updated in place on restore, never inserted.
  {
    fileName: 'user',
    model: models.Users,
    tier: 1,
    scope: { strategy: 'root' },
    restoreMode: 'updateUser',
    single: true,
    fields: ['defaultCategoryId', 'avatar', 'firstName', 'lastName', 'middleName', 'totalBalance'],
  },

  // tier 2
  {
    fileName: 'user-settings',
    model: models.UserSettings,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'zodSettings',
    stripSecret: 'aiKeys',
  },
  {
    fileName: 'users-currencies',
    model: models.UsersCurrencies,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    requireSeededCurrency: true,
  },
  {
    fileName: 'categories',
    model: models.Categories,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    selfRefColumn: 'parentId',
  },
  {
    fileName: 'tags',
    model: models.Tags,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'payees',
    model: models.Payees,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'tag-reminders',
    model: models.TagReminders,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'payee-ignored-names',
    model: models.PayeeIgnoredNames,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'notifications',
    model: models.Notifications,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'venture-platforms',
    model: models.VenturePlatforms,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    paranoid: true,
  },
  {
    fileName: 'bank-data-provider-connections',
    model: models.BankDataProviderConnections,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    stripSecret: 'bankCredentials',
  },
  {
    fileName: 'account-groups',
    model: models.AccountGroup,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    selfRefColumn: 'parentGroupId',
  },
  {
    fileName: 'transaction-automations',
    model: models.TransactionAutomations,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },

  // tier 3
  {
    fileName: 'accounts',
    model: models.Accounts,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'account-groupings',
    model: models.AccountGrouping,
    tier: 3,
    scope: { strategy: 'viaParent', fk: 'accountId', parent: 'accounts' },
    restoreMode: 'insert',
  },
  {
    fileName: 'subscriptions',
    model: models.Subscriptions,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transaction-templates',
    model: models.TransactionTemplates,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'payee-aliases',
    model: models.PayeeAliases,
    tier: 3,
    scope: { strategy: 'viaParent', fk: 'payeeId', parent: 'payees' },
    restoreMode: 'insert',
  },
  {
    fileName: 'payee-tags',
    model: models.PayeeTags,
    tier: 3,
    scope: { strategy: 'viaParent', fk: 'payeeId', parent: 'payees' },
    restoreMode: 'insert',
  },
  {
    fileName: 'category-tags',
    model: models.CategoryTags,
    tier: 3,
    scope: { strategy: 'viaParent', fk: 'categoryId', parent: 'categories' },
    restoreMode: 'insert',
  },
  {
    fileName: 'user-merchant-category-codes',
    model: models.UserMerchantCategoryCodes,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    enrichMccCode: true,
  },
  {
    fileName: 'user-exchange-rates',
    model: models.UserExchangeRates,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'portfolios',
    model: models.Portfolios,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    paranoid: true,
  },
  {
    fileName: 'venture-deals',
    model: models.VentureDeals,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    paranoid: true,
  },
  {
    fileName: 'vehicles',
    model: models.Vehicles,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'loan-details',
    model: models.LoanDetails,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transaction-groups',
    model: models.TransactionGroups,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'budgets',
    model: models.Budgets,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'import-batches',
    model: models.ImportBatches,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },

  // tier 4
  {
    fileName: 'transactions',
    model: models.Transactions,
    tier: 4,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    paranoid: true,
    selfRefColumn: 'mergedIntoId',
  },
  {
    fileName: 'balances',
    model: models.Balances,
    tier: 4,
    scope: { strategy: 'viaParent', fk: 'accountId', parent: 'accounts' },
    restoreMode: 'insert',
  },
  {
    fileName: 'holdings',
    model: models.Holdings,
    tier: 4,
    scope: { strategy: 'viaParent', fk: 'portfolioId', parent: 'portfolios' },
    restoreMode: 'insert',
  },
  {
    fileName: 'investment-transactions',
    model: models.InvestmentTransaction,
    tier: 4,
    scope: { strategy: 'viaParent', fk: 'portfolioId', parent: 'portfolios' },
    restoreMode: 'insert',
  },
  {
    fileName: 'portfolio-balances',
    model: models.PortfolioBalances,
    tier: 4,
    scope: { strategy: 'viaParent', fk: 'portfolioId', parent: 'portfolios' },
    restoreMode: 'insert',
  },
  {
    fileName: 'portfolio-transfers',
    model: models.PortfolioTransfers,
    tier: 4,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'venture-events',
    model: models.VentureEvents,
    tier: 4,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'subscription-candidates',
    model: models.SubscriptionCandidates,
    tier: 4,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'import-batch-account-effects',
    model: models.ImportBatchAccountEffects,
    tier: 4,
    scope: { strategy: 'viaParent', fk: 'importBatchId', parent: 'importBatches' },
    restoreMode: 'insert',
  },

  // tier 5
  {
    fileName: 'transaction-splits',
    model: models.TransactionSplits,
    tier: 5,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transaction-tags',
    model: models.TransactionTags,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'transactionId', parent: 'transactions' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transaction-group-items',
    model: models.TransactionGroupItems,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'groupId', parent: 'transactionGroups' },
    restoreMode: 'insert',
  },
  {
    fileName: 'budget-transactions',
    model: models.BudgetTransactions,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'budgetId', parent: 'budgets' },
    restoreMode: 'insert',
  },
  {
    fileName: 'budget-categories',
    model: models.BudgetCategories,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'budgetId', parent: 'budgets' },
    restoreMode: 'insert',
  },
  {
    fileName: 'refund-transactions',
    model: models.RefundTransactions,
    tier: 5,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'subscription-transactions',
    model: models.SubscriptionTransactions,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'subscriptionId', parent: 'subscriptions' },
    restoreMode: 'insert',
  },
  {
    fileName: 'subscription-tags',
    model: models.SubscriptionTags,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'subscriptionId', parent: 'subscriptions' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transaction-template-tags',
    model: models.TransactionTemplateTags,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'templateId', parent: 'transactionTemplates' },
    restoreMode: 'insert',
  },
  {
    fileName: 'subscription-periods',
    model: models.SubscriptionPeriods,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'subscriptionId', parent: 'subscriptions' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transfer-suggestion-dismissals',
    model: models.TransferSuggestionDismissals,
    tier: 5,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'venture-event-links',
    model: models.VentureEventLinks,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'ventureEventId', parent: 'ventureEvents' },
    restoreMode: 'insert',
  },

  // tier 6
  {
    fileName: 'subscription-period-notifications',
    model: models.SubscriptionPeriodNotifications,
    tier: 6,
    scope: { strategy: 'viaParent', fk: 'periodId', parent: 'subscriptionPeriods' },
    restoreMode: 'insert',
  },

  // Exported for completeness, skipped on restore: they reference counterpart
  // users (sharedWithUserId / inviteeUserId) that don't exist on another instance.
  {
    fileName: 'resource-shares',
    model: models.ResourceShares,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'ownerUserId' },
    restoreMode: 'skip',
  },
  {
    fileName: 'share-invitations',
    model: models.ShareInvitations,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'ownerUserId' },
    restoreMode: 'skip',
  },
] as const satisfies readonly BackupTableDef<string>[];

export type BackupFileName = (typeof TABLE_DEFS)[number]['fileName'];
export const BACKUP_TABLES: readonly BackupTableDef[] = TABLE_DEFS;

interface BackupReferenceDef {
  fileName: BackupReferenceFileName;
  model: AnyModel;
}

/**
 * Global catalog subset embedded under `reference/`. Not owner-scoped: dumped
 * as the exact Securities rows the user's holdings and investment transactions
 * reference (identity only), then resolve-or-create on restore. Prices are NOT
 * dumped — see SecurityPricing in BACKUP_EXCLUDED.
 */
export const REFERENCE_TABLES: readonly BackupReferenceDef[] = [{ fileName: 'securities', model: models.Securities }];

interface BackupExcludedDef {
  model: AnyModel;
  reason: string;
}

/**
 * Global tables deliberately left out of the backup. Listed explicitly so the
 * drift-guard unit test forces a backup decision for every registered model —
 * a new model added without one fails that test.
 */
export const BACKUP_EXCLUDED: readonly BackupExcludedDef[] = [
  { model: models.Currencies, reason: 'Global ISO seed, referenced by natural code — stable across instances.' },
  {
    model: models.ExchangeRates,
    reason: 'Global; self-heals via startup backfill (1999→today) plus the daily rate cron.',
  },
  {
    model: models.MerchantCategoryCodes,
    reason: 'Global seed; user rows carry the natural code for remap on restore.',
  },
  { model: models.BrandLogos, reason: 'Global logo cache, re-resolved by domain string.' },
  { model: models.SecurityCurrencyCache, reason: 'Global symbol→currency cache, re-resolved on demand.' },
  {
    model: models.SecurityPricing,
    reason:
      'Global derived price history, refetched from the market-data provider. Never trusted from an uploaded backup — writing it from an archive would let a crafted backup poison prices for securities other users hold.',
  },
  {
    model: models.BillingSubscriptions,
    reason:
      'Mirror of Stripe, keyed to a Stripe customer — Stripe re-sends it by webhook, restoring it would bind another account.',
  },
  {
    model: models.BillingWebhookEvents,
    reason: 'Webhook dedupe markers for a Stripe account, meaningless outside it.',
  },
  { model: models.SignupLedger, reason: 'Global signup/trial ledger keyed by email hash, not per-user data.' },
  {
    model: models.FeatureUsages,
    reason: 'Feature-trial counters. Restoring them would hand back spent tries on every restore.',
  },
  {
    model: models.TransactionAttachments,
    reason:
      'Rows point at files in attachment storage, which the backup archive does not carry — restoring rows alone would list attachments that cannot be opened. Attachments are not part of backup/restore.',
  },
];

const unresolved = [...BACKUP_TABLES, ...REFERENCE_TABLES, ...BACKUP_EXCLUDED].filter((t) => !t.model);
if (unresolved.length) {
  throw new Error(`Backup registry has ${unresolved.length} entries whose model name is not registered with Sequelize`);
}
