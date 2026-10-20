import type { ChatEntityKind } from '@bt/shared/types';

import { ROUTES_NAMES } from './constants';

/** A route whose page tells the chat nothing about the data on it, only which page it is. */
interface PageChatContext {
  /** The page's name under `chat.context.pages.*`. */
  page: string;
  /** The route param that holds the id of the entity the page is about. */
  entity?: undefined;
}

/** A route that is about one entity: the chip names the entity, and its id comes from the route param. */
interface EntityChatContext {
  page?: undefined;
  entity: { kind: ChatEntityKind; param: string };
}

/**
 * A page where the data must never reach the chat. The panel sends the page's name and nothing a page
 * provides, so a secret on screen cannot end up in a prompt. `reason` says why, for the next reader.
 */
interface SensitiveChatContext {
  page: string;
  entity?: undefined;
  sensitive: { reason: string };
}

/** A route that only redirects: it is never the current route, so it has no context. */
interface RedirectChatContext {
  redirect: true;
}

export type RouteChatContext = PageChatContext | EntityChatContext | SensitiveChatContext | RedirectChatContext;

const page = (name: string): PageChatContext => ({ page: name });
const entity = (kind: ChatEntityKind, param: string): EntityChatContext => ({ entity: { kind, param } });
const sensitive = (name: string, reason: string): SensitiveChatContext => ({ page: name, sensitive: { reason } });
const REDIRECT: RedirectChatContext = { redirect: true };

const AUTH_REASON = 'Credentials, one-time codes and tokens are typed or sit in the URL on the sign-in flow.';

/**
 * What every route tells the chat. A new route has to be added here: the router coverage test fails
 * for a route without an entry, so a page cannot ship without deciding what the chat sees of it.
 * Pages add detail on top (filters, a period, a drawer that is open) with `provideChatPageContext`.
 */
export const ROUTE_CHAT_CONTEXT: Readonly<Record<string, RouteChatContext>> = {
  [ROUTES_NAMES.dashboard]: REDIRECT,
  [ROUTES_NAMES.home]: page('dashboard'),
  [ROUTES_NAMES.accounts]: page('accounts'),
  [ROUTES_NAMES.account]: entity('account', 'id'),
  [ROUTES_NAMES.accountsVehicleDetails]: entity('vehicle', 'id'),
  [ROUTES_NAMES.accountIntegrationDetails]: entity('bankConnection', 'connectionId'),
  [ROUTES_NAMES.bankCallback]: sensitive('bankCallback', "The bank's authorization code arrives in the URL."),
  [ROUTES_NAMES.planned]: REDIRECT,
  [ROUTES_NAMES.plannedSubscriptions]: page('subscriptions'),
  [ROUTES_NAMES.plannedSubscriptionDetails]: entity('subscription', 'id'),
  [ROUTES_NAMES.plannedTrackers]: page('trackers'),
  [ROUTES_NAMES.plannedTrackerDetails]: entity('tracker', 'id'),
  [ROUTES_NAMES.budget]: page('budget'),
  [ROUTES_NAMES.budgetPlan]: entity('budgetPlan', 'planId'),
  [ROUTES_NAMES.subscriptions]: REDIRECT,
  [ROUTES_NAMES.subscriptionDetails]: REDIRECT,
  [ROUTES_NAMES.analytics]: page('analytics'),
  [ROUTES_NAMES.analyticsCashFlow]: page('cashFlow'),
  [ROUTES_NAMES.analyticsNetWorthHistory]: page('netWorthHistory'),
  [ROUTES_NAMES.analyticsFire]: page('fire'),
  [ROUTES_NAMES.analyticsNetWorthDrivers]: page('netWorthDrivers'),
  [ROUTES_NAMES.analyticsInvestmentContributions]: page('investmentContributions'),
  [ROUTES_NAMES.analyticsPivotReport]: page('pivotReport'),
  [ROUTES_NAMES.analyticsInvestmentCalculator]: page('investmentCalculator'),
  [ROUTES_NAMES.analyticsTrendsComparison]: page('trendsComparison'),
  [ROUTES_NAMES.loans]: page('loans'),
  [ROUTES_NAMES.loanDetail]: entity('loan', 'id'),
  [ROUTES_NAMES.investments]: page('investments'),
  [ROUTES_NAMES.portfolioDetail]: entity('portfolio', 'portfolioId'),
  [ROUTES_NAMES.portfolioTransactionsImport]: entity('portfolio', 'portfolioId'),
  [ROUTES_NAMES.venture]: page('venture'),
  [ROUTES_NAMES.venturePlatformsList]: page('venturePlatforms'),
  [ROUTES_NAMES.ventureDealDetail]: entity('ventureDeal', 'dealId'),
  [ROUTES_NAMES.transactions]: page('transactions'),
  [ROUTES_NAMES.transactionGroups]: page('transactionGroups'),
  [ROUTES_NAMES.optimizations]: page('optimizations'),
  [ROUTES_NAMES.optimizationsTransfers]: page('transferMatching'),
  [ROUTES_NAMES.optimizationsAiCategorization]: page('aiCategorization'),
  [ROUTES_NAMES.optimizationsReconciliation]: page('reconciliation'),
  [ROUTES_NAMES.automations]: page('automations'),
  [ROUTES_NAMES.automationCreate]: page('newAutomation'),
  [ROUTES_NAMES.automationDetails]: entity('transactionAutomation', 'id'),
  [ROUTES_NAMES.chat]: page('chat'),
  [ROUTES_NAMES.chatThread]: page('chat'),
  [ROUTES_NAMES.settings]: page('settings'),
  [ROUTES_NAMES.settingsCurrencies]: page('currencies'),
  [ROUTES_NAMES.settingsCategories]: page('categories'),
  [ROUTES_NAMES.settingsTags]: page('tags'),
  [ROUTES_NAMES.settingsPayees]: REDIRECT,
  [ROUTES_NAMES.settingsPayeesManage]: page('payees'),
  [ROUTES_NAMES.settingsPayeesSettings]: page('payeeSettings'),
  [ROUTES_NAMES.settingsPayeeDetail]: entity('payee', 'id'),
  [ROUTES_NAMES.settingsAccounts]: page('accountGroups'),
  [ROUTES_NAMES.settingsDataManagement]: REDIRECT,
  [ROUTES_NAMES.settingsDataManagementImport]: page('dataImport'),
  [ROUTES_NAMES.settingsDataManagementExport]: page('dataExport'),
  [ROUTES_NAMES.settingsDataManagementExportConfigure]: page('dataExport'),
  [ROUTES_NAMES.settingsAppearance]: page('appearance'),
  [ROUTES_NAMES.settingsLanguage]: page('language'),
  [ROUTES_NAMES.settingsGeneral]: page('general'),
  [ROUTES_NAMES.settingsAi]: REDIRECT,
  [ROUTES_NAMES.settingsAiFeatures]: page('aiFeatures'),
  [ROUTES_NAMES.settingsAiModels]: sensitive(
    'aiModels',
    'AI connection API keys and endpoints are entered and shown here.',
  ),
  [ROUTES_NAMES.settingsAiConnectedApps]: sensitive(
    'aiConnectedApps',
    'API tokens and OAuth grants of connected apps are listed here.',
  ),
  [ROUTES_NAMES.settingsAiChatApplied]: page('aiChatApplied'),
  [ROUTES_NAMES.settingsSecurity]: REDIRECT,
  [ROUTES_NAMES.settingsSecurityLoginMethods]: sensitive(
    'loginMethods',
    'Passkeys and linked sign-in providers are managed here.',
  ),
  [ROUTES_NAMES.settingsSecuritySessions]: sensitive('sessions', 'Active sessions and their devices are listed here.'),
  [ROUTES_NAMES.settingsSecurityPassword]: sensitive('password', 'The current and the new password are typed here.'),
  [ROUTES_NAMES.settingsSecurityBackup]: page('backup'),
  [ROUTES_NAMES.settingsSecurityDanger]: page('dangerZone'),
  [ROUTES_NAMES.settingsAdmin]: page('admin'),
  [ROUTES_NAMES.settingsSharedWithMe]: page('sharedWithMe'),
  [ROUTES_NAMES.settingsHousehold]: page('household'),
  [ROUTES_NAMES.settingsSubscriptions]: page('billing'),
  [ROUTES_NAMES.settingsPlanBilling]: page('planBilling'),
  [ROUTES_NAMES.importCsv]: page('importCsv'),
  [ROUTES_NAMES.importStatement]: page('importStatement'),
  [ROUTES_NAMES.importYnab]: page('importYnab'),
  [ROUTES_NAMES.importBudgetBakersWallet]: page('importWallet'),
  [ROUTES_NAMES.importMsMoney]: page('importMsMoney'),
  [ROUTES_NAMES.importOfx]: page('importOfx'),
  [ROUTES_NAMES.importHistory]: page('importHistory'),
  [ROUTES_NAMES.notFound]: page('notFound'),

  [ROUTES_NAMES.auth]: REDIRECT,
  [ROUTES_NAMES.signIn]: sensitive('auth', AUTH_REASON),
  [ROUTES_NAMES.signUp]: sensitive('auth', AUTH_REASON),
  [ROUTES_NAMES.verifyEmail]: sensitive('auth', AUTH_REASON),
  [ROUTES_NAMES.forgotPassword]: sensitive('auth', AUTH_REASON),
  [ROUTES_NAMES.resetPassword]: sensitive('auth', AUTH_REASON),
  [ROUTES_NAMES.welcome]: sensitive('auth', AUTH_REASON),
  [ROUTES_NAMES.authCallback]: sensitive('auth', AUTH_REASON),
  [ROUTES_NAMES.oauthAuthorize]: sensitive('auth', AUTH_REASON),
};

export const isRedirectRoute = (declared: RouteChatContext): declared is RedirectChatContext => 'redirect' in declared;
