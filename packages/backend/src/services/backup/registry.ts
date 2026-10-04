import { BACKUP_FILE_NAMES, type BackupFileName, type BackupReferenceFileName } from '@bt/shared/types';
import AccountGrouping from '@models/accounts-groups/account-grouping.model';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import BillingWebhookEvents from '@models/billing-webhook-events.model';
import BrandLogos from '@models/brand-logos.model';
import BudgetCategories from '@models/budget-categories.model';
import BudgetTransactions from '@models/budget-transactions.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import Currencies from '@models/currencies.model';
import ExchangeRates from '@models/exchange-rates.model';
import FeatureUsages from '@models/feature-usages.model';
import ImportBatchAccountEffects from '@models/import-batch-account-effects.model';
import ImportBatches from '@models/import-batches.model';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityCurrencyCache from '@models/investments/security-currency-cache.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import LoanDetails from '@models/loan-details.model';
import MerchantCategoryCodes from '@models/merchant-category-codes.model';
import Notifications from '@models/notifications.model';
import PayeeAliases from '@models/payee-aliases.model';
import PayeeIgnoredNames from '@models/payee-ignored-names.model';
import PayeeTags from '@models/payee-tags.model';
import Payees from '@models/payees.model';
import RefundTransactions from '@models/refund-transactions.model';
import ResourceShares from '@models/resource-shares.model';
import ShareInvitations from '@models/share-invitations.model';
import SignupLedger from '@models/signup-ledger.model';
import SubscriptionCandidates from '@models/subscription-candidates.model';
import SubscriptionPeriodNotifications from '@models/subscription-period-notifications.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTags from '@models/subscription-tags.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import TagReminders from '@models/tag-reminders.model';
import Tags from '@models/tags.model';
import TransactionAttachments from '@models/transaction-attachments.model';
import TransactionAutomations from '@models/transaction-automations.model';
import TransactionGroupItems from '@models/transaction-group-items.model';
import TransactionGroups from '@models/transaction-groups.model';
import TransactionSplits from '@models/transaction-splits.model';
import TransactionTags from '@models/transaction-tags.model';
import TransactionTemplateTags from '@models/transaction-template-tags.model';
import TransactionTemplates from '@models/transaction-templates.model';
import Transactions from '@models/transactions.model';
import TransferSuggestionDismissals from '@models/transfer-suggestion-dismissals.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UserMerchantCategoryCodes from '@models/user-merchant-category-codes.model';
import UserSettings from '@models/user-settings.model';
import UsersCurrencies from '@models/users-currencies.model';
import Users from '@models/users.model';
import Vehicles from '@models/vehicles.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import VentureEvents from '@models/venture/venture-events.model';
import VenturePlatforms from '@models/venture/venture-platforms.model';
import { Model, type ModelStatic } from 'sequelize';

type AnyModel = ModelStatic<Model>;

/**
 * Parent whose owned-id set scopes an indirect table's dump. Resolved once
 * per export in the scope resolver; join tables that carry no `userId` filter
 * on the parent's ids instead.
 */
export type BackupParentScope =
  | 'accounts'
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

export interface BackupTableDef {
  fileName: BackupFileName;
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
export const BACKUP_TABLES: readonly BackupTableDef[] = [
  // tier 1 — the Users row is updated in place on restore, never inserted.
  {
    fileName: 'user',
    model: Users,
    tier: 1,
    scope: { strategy: 'root' },
    restoreMode: 'updateUser',
    single: true,
    fields: ['defaultCategoryId', 'avatar', 'firstName', 'lastName', 'middleName', 'totalBalance'],
  },

  // tier 2
  {
    fileName: 'user-settings',
    model: UserSettings,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'zodSettings',
    stripSecret: 'aiKeys',
  },
  {
    fileName: 'users-currencies',
    model: UsersCurrencies,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    requireSeededCurrency: true,
  },
  {
    fileName: 'categories',
    model: Categories,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    selfRefColumn: 'parentId',
  },
  {
    fileName: 'tags',
    model: Tags,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'payees',
    model: Payees,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'tag-reminders',
    model: TagReminders,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'payee-ignored-names',
    model: PayeeIgnoredNames,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'notifications',
    model: Notifications,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'venture-platforms',
    model: VenturePlatforms,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    paranoid: true,
  },
  {
    fileName: 'bank-data-provider-connections',
    model: BankDataProviderConnections,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    stripSecret: 'bankCredentials',
  },
  {
    fileName: 'account-groups',
    model: AccountGroup,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    selfRefColumn: 'parentGroupId',
  },
  {
    fileName: 'transaction-automations',
    model: TransactionAutomations,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },

  // tier 3
  {
    fileName: 'accounts',
    model: Accounts,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'account-groupings',
    model: AccountGrouping,
    tier: 3,
    scope: { strategy: 'viaParent', fk: 'accountId', parent: 'accounts' },
    restoreMode: 'insert',
  },
  {
    fileName: 'subscriptions',
    model: Subscriptions,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transaction-templates',
    model: TransactionTemplates,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'payee-aliases',
    model: PayeeAliases,
    tier: 3,
    scope: { strategy: 'viaParent', fk: 'payeeId', parent: 'payees' },
    restoreMode: 'insert',
  },
  {
    fileName: 'payee-tags',
    model: PayeeTags,
    tier: 3,
    scope: { strategy: 'viaParent', fk: 'payeeId', parent: 'payees' },
    restoreMode: 'insert',
  },
  {
    fileName: 'user-merchant-category-codes',
    model: UserMerchantCategoryCodes,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    enrichMccCode: true,
  },
  {
    fileName: 'user-exchange-rates',
    model: UserExchangeRates,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'portfolios',
    model: Portfolios,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    paranoid: true,
  },
  {
    fileName: 'venture-deals',
    model: VentureDeals,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    paranoid: true,
  },
  {
    fileName: 'vehicles',
    model: Vehicles,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'loan-details',
    model: LoanDetails,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transaction-groups',
    model: TransactionGroups,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'budgets',
    model: Budgets,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'import-batches',
    model: ImportBatches,
    tier: 3,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },

  // tier 4
  {
    fileName: 'transactions',
    model: Transactions,
    tier: 4,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
    paranoid: true,
    selfRefColumn: 'mergedIntoId',
  },
  {
    fileName: 'balances',
    model: Balances,
    tier: 4,
    scope: { strategy: 'viaParent', fk: 'accountId', parent: 'accounts' },
    restoreMode: 'insert',
  },
  {
    fileName: 'holdings',
    model: Holdings,
    tier: 4,
    scope: { strategy: 'viaParent', fk: 'portfolioId', parent: 'portfolios' },
    restoreMode: 'insert',
  },
  {
    fileName: 'investment-transactions',
    model: InvestmentTransaction,
    tier: 4,
    scope: { strategy: 'viaParent', fk: 'portfolioId', parent: 'portfolios' },
    restoreMode: 'insert',
  },
  {
    fileName: 'portfolio-balances',
    model: PortfolioBalances,
    tier: 4,
    scope: { strategy: 'viaParent', fk: 'portfolioId', parent: 'portfolios' },
    restoreMode: 'insert',
  },
  {
    fileName: 'portfolio-transfers',
    model: PortfolioTransfers,
    tier: 4,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'venture-events',
    model: VentureEvents,
    tier: 4,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'subscription-candidates',
    model: SubscriptionCandidates,
    tier: 4,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'import-batch-account-effects',
    model: ImportBatchAccountEffects,
    tier: 4,
    scope: { strategy: 'viaParent', fk: 'importBatchId', parent: 'importBatches' },
    restoreMode: 'insert',
  },

  // tier 5
  {
    fileName: 'transaction-splits',
    model: TransactionSplits,
    tier: 5,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transaction-tags',
    model: TransactionTags,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'transactionId', parent: 'transactions' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transaction-group-items',
    model: TransactionGroupItems,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'groupId', parent: 'transactionGroups' },
    restoreMode: 'insert',
  },
  {
    fileName: 'budget-transactions',
    model: BudgetTransactions,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'budgetId', parent: 'budgets' },
    restoreMode: 'insert',
  },
  {
    fileName: 'budget-categories',
    model: BudgetCategories,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'budgetId', parent: 'budgets' },
    restoreMode: 'insert',
  },
  {
    fileName: 'refund-transactions',
    model: RefundTransactions,
    tier: 5,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'subscription-transactions',
    model: SubscriptionTransactions,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'subscriptionId', parent: 'subscriptions' },
    restoreMode: 'insert',
  },
  {
    fileName: 'subscription-tags',
    model: SubscriptionTags,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'subscriptionId', parent: 'subscriptions' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transaction-template-tags',
    model: TransactionTemplateTags,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'templateId', parent: 'transactionTemplates' },
    restoreMode: 'insert',
  },
  {
    fileName: 'subscription-periods',
    model: SubscriptionPeriods,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'subscriptionId', parent: 'subscriptions' },
    restoreMode: 'insert',
  },
  {
    fileName: 'transfer-suggestion-dismissals',
    model: TransferSuggestionDismissals,
    tier: 5,
    scope: { strategy: 'userColumn', column: 'userId' },
    restoreMode: 'insert',
  },
  {
    fileName: 'venture-event-links',
    model: VentureEventLinks,
    tier: 5,
    scope: { strategy: 'viaParent', fk: 'ventureEventId', parent: 'ventureEvents' },
    restoreMode: 'insert',
  },

  // tier 6
  {
    fileName: 'subscription-period-notifications',
    model: SubscriptionPeriodNotifications,
    tier: 6,
    scope: { strategy: 'viaParent', fk: 'periodId', parent: 'subscriptionPeriods' },
    restoreMode: 'insert',
  },

  // Exported for completeness, skipped on restore: they reference counterpart
  // users (sharedWithUserId / inviteeUserId) that don't exist on another instance.
  {
    fileName: 'resource-shares',
    model: ResourceShares,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'ownerUserId' },
    restoreMode: 'skip',
  },
  {
    fileName: 'share-invitations',
    model: ShareInvitations,
    tier: 2,
    scope: { strategy: 'userColumn', column: 'ownerUserId' },
    restoreMode: 'skip',
  },
];

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
export const REFERENCE_TABLES: readonly BackupReferenceDef[] = [{ fileName: 'securities', model: Securities }];

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
  { model: Currencies, reason: 'Global ISO seed, referenced by natural code — stable across instances.' },
  { model: ExchangeRates, reason: 'Global; self-heals via startup backfill (1999→today) plus the daily rate cron.' },
  { model: MerchantCategoryCodes, reason: 'Global seed; user rows carry the natural code for remap on restore.' },
  { model: BrandLogos, reason: 'Global logo cache, re-resolved by domain string.' },
  { model: SecurityCurrencyCache, reason: 'Global symbol→currency cache, re-resolved on demand.' },
  {
    model: SecurityPricing,
    reason:
      'Global derived price history, refetched from the market-data provider. Never trusted from an uploaded backup — writing it from an archive would let a crafted backup poison prices for securities other users hold.',
  },
  {
    model: BillingSubscriptions,
    reason:
      'Mirror of Stripe, keyed to a Stripe customer — Stripe re-sends it by webhook, restoring it would bind another account.',
  },
  { model: BillingWebhookEvents, reason: 'Webhook dedupe markers for a Stripe account, meaningless outside it.' },
  { model: SignupLedger, reason: 'Global signup/trial ledger keyed by email hash, not per-user data.' },
  {
    model: FeatureUsages,
    reason: 'Feature-trial counters. Restoring them would hand back spent tries on every restore.',
  },
  {
    model: TransactionAttachments,
    reason:
      'Rows point at files in attachment storage, which the backup archive does not carry — restoring rows alone would list attachments that cannot be opened. Attachments are not part of backup/restore.',
  },
];

/**
 * Runtime completeness check: a table registered in BACKUP_TABLES without a
 * matching name in the shared `BACKUP_FILE_NAMES` array (or vice versa) throws
 * on module load, before the first backup request. Mirrors the Data Export
 * registry's drift check so the two lists can't diverge silently.
 */
const registeredNames = new Set(BACKUP_TABLES.map((t) => t.fileName));
const missing = BACKUP_FILE_NAMES.filter((n) => !registeredNames.has(n));
const extras = [...registeredNames].filter((n) => !(BACKUP_FILE_NAMES as readonly string[]).includes(n));
if (missing.length || extras.length) {
  throw new Error(
    `BACKUP_TABLES registry drifted from BACKUP_FILE_NAMES – missing: [${missing.join(', ')}], extras: [${extras.join(', ')}]`,
  );
}
