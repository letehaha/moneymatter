import { isPerfDebugEnabled, registerPerfQueryHooks } from '@common/lib/perf/perf-debug';
import { types as pgTypes } from 'pg';
import { Sequelize } from 'sequelize-typescript';

import AccountGroupingModel from './accounts-groups/account-grouping.model';
import AccountGroupsModel from './accounts-groups/account-groups.model';
import AccountsModel from './accounts.model';
import BalancesModel from './balances.model';
import BankDataProviderConnectionsModel from './bank-data-provider-connections.model';
import BillingSubscriptionsModel from './billing-subscriptions.model';
import BillingWebhookEventsModel from './billing-webhook-events.model';
import BrandLogosModel from './brand-logos.model';
import BudgetCategoriesModel from './budget-categories.model';
import BudgetTagsModel from './budget-tags.model';
import BudgetTransactionsModel from './budget-transactions.model';
import BudgetModel from './budget.model';
import CategoriesModel from './categories.model';
import { connection } from './connection';
import CurrenciesModel from './currencies.model';
import ExchangeRatesModel from './exchange-rates.model';
import FeatureUsagesModel from './feature-usages.model';
import HoldingsModel from './investments/holdings.model';
import InvestmentTransactionModel from './investments/investment-transaction.model';
import PortfolioBalancesModel from './investments/portfolio-balances.model';
import PortfolioTransfersModel from './investments/portfolio-transfers.model';
import PortfoliosModel from './investments/portfolios.model';
import SecuritiesModel from './investments/securities.model';
import SecurityCurrencyCacheModel from './investments/security-currency-cache.model';
import SecurityPricingModel from './investments/security-pricing.model';
import LoanDetailsModel from './loan-details.model';
import MerchantCategoryCodesModel from './merchant-category-codes.model';
import NotificationsModel from './notifications.model';
import PayeeAliasesModel from './payee-aliases.model';
import PayeeIgnoredNamesModel from './payee-ignored-names.model';
import PayeeTagsModel from './payee-tags.model';
import PayeesModel from './payees.model';
import RefundTransactionsModel from './refund-transactions.model';
import ResourceSharesModel from './resource-shares.model';
import ShareInvitationsModel from './share-invitations.model';
import SignupLedgerModel from './signup-ledger.model';
import SubscriptionCandidatesModel from './subscription-candidates.model';
import SubscriptionPeriodNotificationsModel from './subscription-period-notifications.model';
import SubscriptionPeriodsModel from './subscription-periods.model';
import SubscriptionTagsModel from './subscription-tags.model';
import SubscriptionTransactionsModel from './subscription-transactions.model';
import SubscriptionsModel from './subscriptions.model';
import TagRemindersModel from './tag-reminders.model';
import TagsModel from './tags.model';
import TransactionAttachmentsModel from './transaction-attachments.model';
import TransactionAutomationsModel from './transaction-automations.model';
import TransactionGroupItemsModel from './transaction-group-items.model';
import TransactionGroupsModel from './transaction-groups.model';
import TransactionSplitsModel from './transaction-splits.model';
import TransactionTagsModel from './transaction-tags.model';
import TransactionTemplateTagsModel from './transaction-template-tags.model';
import TransactionTemplatesModel from './transaction-templates.model';
import TransactionsModel from './transactions.model';
import TransferSuggestionDismissalsModel from './transfer-suggestion-dismissals.model';
import UserExchangeRatesModel from './user-exchange-rates.model';
import UserMerchantCategoryCodesModel from './user-merchant-category-codes.model';
import UserSettingsModel from './user-settings.model';
import UsersCurrenciesModel from './users-currencies.model';
import UsersModel from './users.model';
import VehiclesModel from './vehicles.model';
import VentureDealsModel from './venture/venture-deals.model';
import VentureEventLinksModel from './venture/venture-event-links.model';
import VentureEventsModel from './venture/venture-events.model';
import VenturePlatformsModel from './venture/venture-platforms.model';

// node-postgres returns BIGINT as string to preserve precision. Our cents
// columns are BIGINT, but cent values stay far below JS Number's safe 2^53
// ceiling (~$90T). Parse to Number so model getters, hooks, raw queries, and
// API serializers all see numbers uniformly. pg only invokes the parser for
// non-null values, so we don't need a null branch.
pgTypes.setTypeParser(pgTypes.builtins.INT8, (val) => Number(val));

const DBConfig: Record<string, unknown> = {
  host: process.env.APPLICATION_DB_HOST,
  username: process.env.APPLICATION_DB_USERNAME,
  password: process.env.APPLICATION_DB_PASSWORD,
  database: process.env.APPLICATION_DB_DATABASE,
  port: process.env.APPLICATION_DB_PORT,
  dialect: process.env.APPLICATION_DB_DIALECT,
};

const models = [
  UsersModel,
  AccountsModel,
  BalancesModel,
  BankDataProviderConnectionsModel,
  CategoriesModel,
  CurrenciesModel,
  ExchangeRatesModel,
  FeatureUsagesModel,
  MerchantCategoryCodesModel,
  NotificationsModel,
  RefundTransactionsModel,
  ResourceSharesModel,
  ShareInvitationsModel,
  TransactionsModel,
  UserExchangeRatesModel,
  UserMerchantCategoryCodesModel,
  UserSettingsModel,
  UsersCurrenciesModel,
  AccountGroupingModel,
  AccountGroupsModel,
  BudgetModel,
  BudgetCategoriesModel,
  BudgetTagsModel,
  BudgetTransactionsModel,
  TagsModel,
  TagRemindersModel,
  TransactionTagsModel,
  TransactionSplitsModel,
  TransactionGroupsModel,
  TransactionGroupItemsModel,
  TransactionTemplatesModel,
  BillingSubscriptionsModel,
  BillingWebhookEventsModel,
  SignupLedgerModel,
  TransactionTemplateTagsModel,
  HoldingsModel,
  InvestmentTransactionModel,
  SecuritiesModel,
  SecurityCurrencyCacheModel,
  SecurityPricingModel,
  PortfoliosModel,
  PortfolioBalancesModel,
  PortfolioTransfersModel,
  SubscriptionsModel,
  SubscriptionPeriodsModel,
  SubscriptionPeriodNotificationsModel,
  SubscriptionTransactionsModel,
  SubscriptionTagsModel,
  SubscriptionCandidatesModel,
  PayeesModel,
  PayeeAliasesModel,
  BrandLogosModel,
  PayeeIgnoredNamesModel,
  PayeeTagsModel,
  TransferSuggestionDismissalsModel,
  VenturePlatformsModel,
  VentureDealsModel,
  VentureEventsModel,
  VentureEventLinksModel,
  VehiclesModel,
  LoanDetailsModel,
  TransactionAutomationsModel,
  TransactionAttachmentsModel,
];

const sequelize = new Sequelize({
  ...DBConfig,
  database:
    process.env.NODE_ENV === 'test'
      ? `${DBConfig.database}-${process.env.JEST_WORKER_ID}`
      : (DBConfig.database as string),
  models,
  // Prod: a single dashboard load fans out several stats requests at once, so
  // keep enough warm connections (`min`) and let burst connections linger
  // (`idle`) — establishing a physical Postgres connection is slow and
  // otherwise happens in the middle of user requests.
  pool:
    process.env.NODE_ENV === 'test'
      ? { max: 50, min: 0, evict: 10_000 }
      : { max: 50, min: 10, idle: 30_000, evict: 60_000 },
  // TCP keepalive stops idle pooled connections from being silently dropped by
  // intermediate networking (Docker NAT/proxy) — a dead connection is only
  // discovered at checkout, forcing a slow reconnect inside a request.
  dialectOptions: { keepAlive: true },
  logging: process.env.DB_QUERY_LOGGING === 'true',
});

// Opt-in (PERF_DEBUG=true): count + time each query against the in-flight request.
if (isPerfDebugEnabled) {
  registerPerfQueryHooks(sequelize);
}

if (process.env.NODE_ENV === 'development') {
  console.log('DBConfig', DBConfig);
}

connection.sequelize = sequelize;
connection.Sequelize = Sequelize;

export { connection };
