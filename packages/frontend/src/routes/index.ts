import { i18nChunkGuard } from '@/i18n/route-guard';
import type { I18nChunkName } from '@/i18n/types';
import type { RouteRecordRaw } from 'vue-router';
import { createRouter, createWebHistory } from 'vue-router';

import { ROUTES_NAMES } from './constants';
import { authPageGuard, baseCurrencyExists, billingPageGuard, redirectRouteGuard } from './guards';

export { ROUTES_NAMES } from './constants';

const routes: RouteRecordRaw[] = [
  {
    path: '/app',
    name: ROUTES_NAMES.dashboard,
    component: () => import('@/layouts/dashboard.vue'),
    beforeEnter: [redirectRouteGuard, baseCurrencyExists],
    redirect: () => ({ name: ROUTES_NAMES.home }),
    meta: {
      // Layout chunks loaded for all dashboard pages. `pages/payees` is in here
      // because PayeeSelectField / the New Payee dialog can be reached from any
      // route via the transaction-create dialog; loading it lazily races the
      // first render and leaves option labels stuck on raw keys.
      i18nChunks: ['layout', 'dialogs', 'forms', 'errors', 'pages/payees'] as I18nChunkName[],
    },
    children: [
      {
        path: '/dashboard',
        name: ROUTES_NAMES.home,
        component: () => import('@/pages/dashboard/dashboard.vue'),
        meta: { i18nChunks: ['pages/dashboard', 'pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/accounts',
        name: ROUTES_NAMES.accounts,
        component: () => import('@/pages/accounts/accounts.vue'),
        meta: { i18nChunks: ['pages/accounts'] as I18nChunkName[] },
      },
      {
        path: '/account/:id',
        name: ROUTES_NAMES.account,
        component: () => import('@/pages/account/account.vue'),
        meta: { i18nChunks: ['pages/account', 'pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/accounts/vehicles/:id',
        name: ROUTES_NAMES.accountsVehicleDetails,
        component: () => import('@/pages/accounts/vehicle-details.vue'),
        meta: { i18nChunks: ['pages/accounts', 'pages/account', 'pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/accounts/integrations',
        redirect: { name: ROUTES_NAMES.accounts },
      },
      {
        path: '/accounts/integrations/:connectionId',
        name: ROUTES_NAMES.accountIntegrationDetails,
        component: () => import('@/pages/accounts/integrations/details.vue'),
        meta: { i18nChunks: ['pages/account-integrations'] as I18nChunkName[] },
      },
      {
        path: '/bank-callback',
        name: ROUTES_NAMES.bankCallback,
        component: () => import('@/pages/bank-callback.vue'),
        meta: { i18nChunks: ['pages/account-integrations'] as I18nChunkName[] },
      },
      {
        path: '/loans',
        name: ROUTES_NAMES.loans,
        component: () => import('@/pages/loans/index.vue'),
        meta: { i18nChunks: ['pages/loans'] as I18nChunkName[] },
      },
      {
        path: '/loans/:id',
        name: ROUTES_NAMES.loanDetail,
        component: () => import('@/pages/loans/detail.vue'),
        meta: { i18nChunks: ['pages/loans', 'pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/investments',
        name: ROUTES_NAMES.investments,
        component: () => import('@/pages/investments/investments.vue'),
        meta: { i18nChunks: ['pages/investments'] as I18nChunkName[] },
      },
      {
        path: '/portfolios/:portfolioId',
        name: ROUTES_NAMES.portfolioDetail,
        component: () => import('@/pages/portfolios/portfolio-detail.vue'),
        meta: {
          i18nChunks: ['pages/portfolio-detail', 'pages/investments', 'pages/transactions'] as I18nChunkName[],
        },
      },
      {
        path: '/portfolios/:portfolioId/import-transactions',
        name: ROUTES_NAMES.portfolioTransactionsImport,
        component: () => import('@/pages/portfolios/transactions-import/page.vue'),
        meta: {
          i18nChunks: ['pages/investments-import', 'pages/portfolio-detail'] as I18nChunkName[],
        },
      },
      {
        path: '/venture',
        name: ROUTES_NAMES.venture,
        component: () => import('@/pages/venture/venture.vue'),
        meta: { i18nChunks: ['pages/venture'] as I18nChunkName[] },
      },
      {
        path: '/venture/platforms',
        name: ROUTES_NAMES.venturePlatformsList,
        component: () => import('@/pages/venture/platforms.vue'),
        meta: { i18nChunks: ['pages/venture'] as I18nChunkName[] },
      },
      {
        path: '/venture/deals/:dealId',
        name: ROUTES_NAMES.ventureDealDetail,
        component: () => import('@/pages/venture/deal-detail.vue'),
        meta: { i18nChunks: ['pages/venture', 'pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/analytics',
        name: ROUTES_NAMES.analytics,
        component: () => import('@/pages/analytics/index.vue'),
        meta: { i18nChunks: ['pages/analytics', 'pages/transactions'] as I18nChunkName[] },
        children: [
          {
            path: 'trends-comparison',
            name: ROUTES_NAMES.analyticsTrendsComparison,
            component: () => import('@/pages/analytics/subpages/annual-overview/index.vue'),
          },
          {
            path: 'cash-flow',
            name: ROUTES_NAMES.analyticsCashFlow,
            component: () => import('@/pages/analytics/subpages/cash-flow/index.vue'),
          },
          {
            path: 'net-worth-history',
            name: ROUTES_NAMES.analyticsNetWorthHistory,
            component: () => import('@/pages/analytics/subpages/net-worth-history/index.vue'),
          },
          {
            path: 'fire',
            name: ROUTES_NAMES.analyticsFire,
            component: () => import('@/pages/analytics/subpages/fire/index.vue'),
          },
          {
            path: 'net-worth-drivers',
            name: ROUTES_NAMES.analyticsNetWorthDrivers,
            component: () => import('@/pages/analytics/subpages/net-worth-drivers/index.vue'),
          },
          {
            path: 'investment-contributions',
            name: ROUTES_NAMES.analyticsInvestmentContributions,
            component: () => import('@/pages/analytics/subpages/investment-contributions/index.vue'),
          },
          {
            path: 'pivot-report',
            name: ROUTES_NAMES.analyticsPivotReport,
            component: () => import('@/pages/analytics/subpages/pivot-report/index.vue'),
          },
          {
            path: 'investment-calculator',
            name: ROUTES_NAMES.analyticsInvestmentCalculator,
            component: () => import('@/pages/analytics/subpages/investment-calculator/index.vue'),
          },
        ],
      },
      {
        path: '/planned',
        name: ROUTES_NAMES.planned,
        component: () => import('@/pages/planned/index.vue'),
        redirect: { name: ROUTES_NAMES.plannedSubscriptions },
        meta: { i18nChunks: ['pages/planned'] as I18nChunkName[] },
        children: [
          {
            path: 'recurring-payments',
            name: ROUTES_NAMES.plannedSubscriptions,
            component: () => import('@/pages/planned/subscriptions/index.vue'),
          },
          {
            path: 'recurring-payments/:id',
            name: ROUTES_NAMES.plannedSubscriptionDetails,
            component: () => import('@/pages/planned/subscriptions/subscription-details.vue'),
          },
          {
            path: 'budgets',
            name: ROUTES_NAMES.plannedBudgets,
            component: () => import('@/pages/budgets/budgets.vue'),
            meta: { i18nChunks: ['pages/budgets'] as I18nChunkName[] },
          },
          {
            path: 'budgets/:id',
            name: ROUTES_NAMES.plannedBudgetDetails,
            component: () => import('@/pages/budgets/budgets-info/index.vue'),
            meta: {
              i18nChunks: ['pages/budgets', 'pages/budget-details', 'pages/transactions'] as I18nChunkName[],
            },
          },
        ],
      },
      // Backward-compat redirects for old budget URLs
      {
        path: '/budgets',
        name: ROUTES_NAMES.budgets,
        redirect: { name: ROUTES_NAMES.plannedBudgets },
      },
      {
        path: '/budgets/:id',
        name: ROUTES_NAMES.budgetsInfo,
        redirect: (to) => ({
          name: ROUTES_NAMES.plannedBudgetDetails,
          params: { id: to.params.id },
        }),
      },
      // Backward-compat redirects for the old /planned/subscriptions URLs, so links
      // already sent (e.g. payment reminder emails) still resolve after the rename
      // to /planned/recurring-payments.
      {
        path: '/planned/subscriptions',
        name: ROUTES_NAMES.subscriptions,
        redirect: { name: ROUTES_NAMES.plannedSubscriptions },
      },
      {
        path: '/planned/subscriptions/:id',
        name: ROUTES_NAMES.subscriptionDetails,
        redirect: (to) => ({
          name: ROUTES_NAMES.plannedSubscriptionDetails,
          params: { id: to.params.id },
        }),
      },
      {
        path: '/transactions',
        name: ROUTES_NAMES.transactions,
        component: () => import('@/pages/records/root.vue'),
        meta: { i18nChunks: ['pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/transaction-groups',
        name: ROUTES_NAMES.transactionGroups,
        component: () => import('@/pages/transaction-groups/index.vue'),
        meta: { i18nChunks: ['pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/transactions/optimizations',
        name: ROUTES_NAMES.optimizations,
        component: () => import('@/pages/optimizations/index.vue'),
        meta: { i18nChunks: ['pages/optimizations', 'pages/automations', 'pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/transactions/optimizations/transfers',
        name: ROUTES_NAMES.optimizationsTransfers,
        component: () => import('@/pages/optimizations/transfers/index.vue'),
        meta: { i18nChunks: ['pages/optimizations', 'pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/transactions/optimizations/ai-categorization',
        name: ROUTES_NAMES.optimizationsAiCategorization,
        component: () => import('@/pages/optimizations/ai-categorization/index.vue'),
        meta: { i18nChunks: ['pages/optimizations', 'pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/transactions/optimizations/reconciliation',
        name: ROUTES_NAMES.optimizationsReconciliation,
        component: () => import('@/pages/optimizations/reconciliation/index.vue'),
        meta: { i18nChunks: ['pages/optimizations', 'pages/transactions'] as I18nChunkName[] },
      },
      {
        path: '/transactions/automations',
        name: ROUTES_NAMES.automations,
        component: () => import('@/pages/automations/index.vue'),
        meta: { i18nChunks: ['pages/automations'] as I18nChunkName[] },
      },
      {
        path: '/transactions/automations/new',
        name: ROUTES_NAMES.automationCreate,
        component: () => import('@/pages/automations/editor.vue'),
        meta: { i18nChunks: ['pages/automations'] as I18nChunkName[] },
      },
      {
        path: '/transactions/automations/:id',
        name: ROUTES_NAMES.automationDetails,
        component: () => import('@/pages/automations/editor.vue'),
        meta: { i18nChunks: ['pages/automations'] as I18nChunkName[] },
      },
      {
        path: '/settings',
        name: ROUTES_NAMES.settings,
        component: () => import('@/pages/settings/settings.vue'),
        meta: {
          i18nChunks: [
            'settings/index',
            'settings/categories',
            'settings/tags',
            'settings/currencies',
            'settings/accounts-groups',
            'settings/data-management',
            'settings/appearance',
            'settings/language',
            'settings/general',
            'settings/ai',
            'settings/security',
            'settings/admin',
            'pages/shared-with-me',
          ] as I18nChunkName[],
        },
        children: [
          {
            path: 'categories',
            name: ROUTES_NAMES.settingsCategories,
            component: () => import('@/pages/settings/subpages/categories/index.vue'),
            meta: { i18nChunks: ['settings/categories'] as I18nChunkName[] },
          },
          {
            path: 'plan-billing',
            name: ROUTES_NAMES.settingsPlanBilling,
            beforeEnter: billingPageGuard,
            component: () => import('@/pages/settings/subpages/plan-billing/index.vue'),
            meta: { i18nChunks: ['settings/plan-billing'] as I18nChunkName[] },
          },
          {
            path: 'tags',
            name: ROUTES_NAMES.settingsTags,
            component: () => import('@/pages/settings/subpages/tags/index.vue'),
            meta: { i18nChunks: ['settings/tags'] as I18nChunkName[] },
          },
          {
            path: 'payees',
            name: ROUTES_NAMES.settingsPayees,
            component: () => import('@/pages/settings/subpages/payees/index.vue'),
            redirect: { name: ROUTES_NAMES.settingsPayeesManage },
            meta: { i18nChunks: ['pages/payees'] as I18nChunkName[] },
            children: [
              {
                path: 'manage',
                name: ROUTES_NAMES.settingsPayeesManage,
                component: () => import('@/pages/settings/subpages/payees/pages/manage.vue'),
              },
              {
                path: 'settings',
                name: ROUTES_NAMES.settingsPayeesSettings,
                component: () => import('@/pages/settings/subpages/payees/pages/settings.vue'),
              },
            ],
          },
          {
            path: 'payees/:id',
            name: ROUTES_NAMES.settingsPayeeDetail,
            component: () => import('@/pages/settings/subpages/payees/detail.vue'),
            meta: { i18nChunks: ['pages/payees'] as I18nChunkName[] },
          },
          {
            path: 'currencies',
            name: ROUTES_NAMES.settingsCurrencies,
            component: () => import('@/pages/settings/subpages/currencies/index.vue'),
            meta: { i18nChunks: ['settings/currencies'] as I18nChunkName[] },
          },
          {
            path: 'accounts',
            name: ROUTES_NAMES.settingsAccounts,
            component: () => import('@/pages/settings/subpages/accounts-groups/index.vue'),
            meta: { i18nChunks: ['settings/accounts-groups'] as I18nChunkName[] },
          },
          {
            path: 'data-management',
            name: ROUTES_NAMES.settingsDataManagement,
            component: () => import('@/pages/settings/subpages/data-management/index.vue'),
            redirect: { name: ROUTES_NAMES.settingsDataManagementImport },
            meta: { i18nChunks: ['settings/data-management'] as I18nChunkName[] },
            children: [
              {
                path: 'import',
                name: ROUTES_NAMES.settingsDataManagementImport,
                component: () => import('@/pages/settings/subpages/data-management/pages/import.vue'),
              },
              {
                path: 'export',
                name: ROUTES_NAMES.settingsDataManagementExport,
                component: () => import('@/pages/settings/subpages/data-management/pages/export.vue'),
              },
            ],
          },
          {
            path: 'data-management/export/configure',
            name: ROUTES_NAMES.settingsDataManagementExportConfigure,
            component: () => import('@/pages/settings/subpages/data-management/pages/export-configure.vue'),
            meta: { i18nChunks: ['settings/data-management'] as I18nChunkName[] },
          },
          {
            path: 'data-management/import/csv',
            name: ROUTES_NAMES.importCsv,
            component: () => import('@/pages/import-export/csv-import.vue'),
            meta: {
              i18nChunks: ['pages/import-csv', 'pages/import-shared', 'settings/data-management'] as I18nChunkName[],
            },
          },
          {
            path: 'data-management/import/text-source',
            name: ROUTES_NAMES.importStatement,
            component: () => import('@/pages/import-export/statement-parser/index.vue'),
            meta: { i18nChunks: ['pages/import-statement', 'settings/data-management'] as I18nChunkName[] },
          },
          {
            path: 'data-management/import/ynab',
            name: ROUTES_NAMES.importYnab,
            component: () => import('@/pages/import-export/ynab-import/index.vue'),
            meta: {
              i18nChunks: ['pages/import-ynab', 'pages/import-shared', 'settings/data-management'] as I18nChunkName[],
            },
          },
          {
            path: 'data-management/import/budget-bakers-wallet',
            name: ROUTES_NAMES.importBudgetBakersWallet,
            component: () => import('@/pages/import-export/budget-bakers-wallet-import/index.vue'),
            meta: {
              i18nChunks: [
                'pages/import-budget-bakers-wallet',
                'pages/import-shared',
                'settings/data-management',
              ] as I18nChunkName[],
            },
          },
          {
            path: 'data-management/import/ms-money',
            name: ROUTES_NAMES.importMsMoney,
            component: () => import('@/pages/import-export/ms-money-import/index.vue'),
            meta: {
              i18nChunks: [
                'pages/import-ms-money',
                'pages/import-shared',
                'settings/data-management',
              ] as I18nChunkName[],
            },
          },
          {
            path: 'data-management/import/ofx',
            name: ROUTES_NAMES.importOfx,
            component: () => import('@/pages/import-export/ofx-import/index.vue'),
            meta: {
              i18nChunks: ['pages/import-ofx', 'pages/import-shared', 'settings/data-management'] as I18nChunkName[],
            },
          },
          {
            path: 'data-management/import/history',
            name: ROUTES_NAMES.importHistory,
            component: () => import('@/pages/import-export/import-history/index.vue'),
            meta: { i18nChunks: ['pages/import-history', 'settings/data-management'] as I18nChunkName[] },
          },
          {
            path: 'appearance',
            name: ROUTES_NAMES.settingsAppearance,
            component: () => import('@/pages/settings/subpages/appearance/index.vue'),
            meta: { i18nChunks: ['settings/appearance'] as I18nChunkName[] },
          },
          {
            path: 'language',
            name: ROUTES_NAMES.settingsLanguage,
            component: () => import('@/pages/settings/subpages/language/index.vue'),
            meta: { i18nChunks: ['settings/language'] as I18nChunkName[] },
          },
          {
            path: 'general',
            name: ROUTES_NAMES.settingsGeneral,
            component: () => import('@/pages/settings/subpages/general/index.vue'),
            meta: { i18nChunks: ['settings/general'] as I18nChunkName[] },
          },
          {
            path: 'admin',
            name: ROUTES_NAMES.settingsAdmin,
            component: () => import('@/pages/settings/subpages/admin/index.vue'),
            meta: { i18nChunks: ['settings/admin'] as I18nChunkName[] },
          },
          {
            path: 'ai',
            name: ROUTES_NAMES.settingsAi,
            component: () => import('@/pages/settings/subpages/ai/index.vue'),
            redirect: { name: ROUTES_NAMES.settingsAiFeatures },
            // Chunk names match the Crowdin files, so the merged page keeps both.
            meta: { i18nChunks: ['settings/ai', 'settings/ai-integrations'] as I18nChunkName[] },
            children: [
              {
                path: 'features',
                name: ROUTES_NAMES.settingsAiFeatures,
                component: () => import('@/pages/settings/subpages/ai/pages/features.vue'),
              },
              {
                path: 'models',
                name: ROUTES_NAMES.settingsAiModels,
                component: () => import('@/pages/settings/subpages/ai/pages/models.vue'),
              },
              {
                path: 'connected-apps',
                name: ROUTES_NAMES.settingsAiConnectedApps,
                component: () => import('@/pages/settings/subpages/ai/pages/connected-apps.vue'),
              },
              { path: 'keys', redirect: { name: ROUTES_NAMES.settingsAiModels } },
              { path: 'endpoints', redirect: { name: ROUTES_NAMES.settingsAiModels } },
            ],
          },
          {
            path: 'security',
            name: ROUTES_NAMES.settingsSecurity,
            component: () => import('@/pages/settings/subpages/security/index.vue'),
            redirect: { name: ROUTES_NAMES.settingsSecurityLoginMethods },
            meta: { i18nChunks: ['settings/security'] as I18nChunkName[] },
            children: [
              {
                path: 'login-methods',
                name: ROUTES_NAMES.settingsSecurityLoginMethods,
                component: () => import('@/pages/settings/subpages/security/pages/login-methods.vue'),
              },
              {
                path: 'sessions',
                name: ROUTES_NAMES.settingsSecuritySessions,
                component: () => import('@/pages/settings/subpages/security/pages/sessions.vue'),
              },
              {
                path: 'password',
                name: ROUTES_NAMES.settingsSecurityPassword,
                component: () => import('@/pages/settings/subpages/security/pages/password.vue'),
              },
              {
                path: 'backup',
                name: ROUTES_NAMES.settingsSecurityBackup,
                component: () => import('@/pages/settings/subpages/security/pages/backup.vue'),
              },
              {
                path: 'danger',
                name: ROUTES_NAMES.settingsSecurityDanger,
                component: () => import('@/pages/settings/subpages/security/pages/danger-zone.vue'),
              },
            ],
          },
          {
            path: 'ai-integrations',
            redirect: { name: ROUTES_NAMES.settingsAiConnectedApps },
          },
          {
            path: 'shared-with-me',
            name: ROUTES_NAMES.settingsSharedWithMe,
            component: () => import('@/pages/shared-with-me/shared-with-me.vue'),
            meta: { i18nChunks: ['pages/shared-with-me'] as I18nChunkName[] },
          },
          {
            path: 'household',
            name: ROUTES_NAMES.settingsHousehold,
            component: () => import('@/pages/settings/subpages/household/index.vue'),
            meta: { i18nChunks: ['pages/household'] as I18nChunkName[] },
          },
          {
            path: 'subscriptions',
            name: ROUTES_NAMES.settingsSubscriptions,
            component: () => import('@/pages/settings/subpages/subscriptions/index.vue'),
            meta: { i18nChunks: ['settings/subscriptions'] as I18nChunkName[] },
          },
        ],
      },
    ],
  },
  {
    path: '/auth',
    name: ROUTES_NAMES.auth,
    component: () => import('@/layouts/auth.vue'),
    redirect: () => ({ name: ROUTES_NAMES.signIn }),
    children: [
      {
        path: '/sign-in',
        name: ROUTES_NAMES.signIn,
        beforeEnter: authPageGuard,
        component: () => import('@/pages/auth/login.vue'),
        meta: { i18nChunks: ['auth/sign-in'] as I18nChunkName[] },
      },
      {
        path: '/sign-up',
        name: ROUTES_NAMES.signUp,
        beforeEnter: authPageGuard,
        component: () => import('@/pages/auth/register.vue'),
        meta: { i18nChunks: ['auth/sign-up'] as I18nChunkName[] },
      },
      {
        path: '/verify-email',
        name: ROUTES_NAMES.verifyEmail,
        component: () => import('@/pages/auth/verify-email.vue'),
        meta: { i18nChunks: ['auth/verify-email'] as I18nChunkName[] },
      },
      {
        path: '/welcome',
        name: ROUTES_NAMES.welcome,
        beforeEnter: redirectRouteGuard,
        component: () => import('@/pages/auth/welcome.vue'),
        meta: { i18nChunks: ['auth/welcome', 'forms'] as I18nChunkName[] },
      },
      {
        path: '/auth/callback',
        name: ROUTES_NAMES.authCallback,
        component: () => import('@/pages/auth/oauth-callback.vue'),
        meta: { i18nChunks: ['auth/welcome'] as I18nChunkName[] },
      },
      {
        path: '/oauth/authorize',
        name: ROUTES_NAMES.oauthAuthorize,
        component: () => import('@/pages/auth/oauth-authorize.vue'),
        meta: { i18nChunks: ['auth/oauth-authorize'] as I18nChunkName[] },
      },
    ],
  },
  // In production, "/" is served by Astro (via nginx). In dev, redirect to the app.
  {
    path: '/',
    redirect: { name: ROUTES_NAMES.dashboard },
  },
  {
    path: '/:pathMatch(.*)*',
    name: ROUTES_NAMES.notFound,
    component: () => import('@/pages/not-found/not-found.vue'),
    meta: { i18nChunks: ['errors'] as I18nChunkName[] },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore dunno why but TS is stupidly angry here for now reason, after
  // adding nested routes for settings
  routes,
});

// Register global i18n chunk loading guard
router.beforeResolve(i18nChunkGuard);
