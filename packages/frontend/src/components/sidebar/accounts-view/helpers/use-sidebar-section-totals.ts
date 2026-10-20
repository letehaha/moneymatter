import { useAccountGroupsQuery } from '@/composable/data-queries/account-groups';
import { useLoans } from '@/composable/data-queries/loans';
import { usePortfolioSummaries } from '@/composable/data-queries/portfolio-summary';
import { useVentureDeals } from '@/composable/data-queries/venture/deals';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import { useIdleEnabled } from '@/composable/use-idle-enabled';
import { useSidebarSections } from '@/composable/use-sidebar-sections';
import { partitionLoans } from '@/pages/loans/utils/partition-loans';
import { useAccountsStore } from '@/stores';
import { ACCOUNT_CATEGORIES, AccountModel } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

import { flattenAccounts } from './account-totals';

/**
 * Per-section account splits, base-currency totals and visibility flags for the accounts view.
 * Every query here is keyed the same way as its standalone counterpart, so these dedupe with the
 * per-row calls instead of firing a second request each.
 */
export const useSidebarSectionTotals = () => {
  const { activeAccounts, isAccountsFetched } = storeToRefs(useAccountsStore());
  const { data: accountGroupsData, isLoading: isGroupsLoading } = useAccountGroupsQuery({ placeholderData: [] });
  const accountGroups = computed(() => accountGroupsData.value ?? []);

  // Wait for both accounts and groups to load to prevent layout shift
  const isLoading = computed(() => !isAccountsFetched.value || isGroupsLoading.value);

  const accountsInGroups = computed(() => flattenAccounts({ groups: accountGroups.value }));

  // Vehicle and loan accounts get their own "Cars" and "Loans" sections, so keep
  // them out of the Bank Accounts list.
  const isVehicleAccount = (account: AccountModel) => account.accountCategory === ACCOUNT_CATEGORIES.vehicle;
  const isLoanAccount = (account: AccountModel) => account.accountCategory === ACCOUNT_CATEGORIES.loan;
  const vehicleAccounts = computed(() => activeAccounts.value.filter(isVehicleAccount));
  const accountsWithoutGroups = computed(() =>
    activeAccounts.value.filter((i) => !accountsInGroups.value[i.id] && !isVehicleAccount(i) && !isLoanAccount(i)),
  );

  const { baseCurrencyCode, sumBaseBalance } = useBaseBalanceTotals();

  // Bank Accounts total = every account rendered under the section (grouped + ungrouped).
  const bankAccountsTotal = computed(() =>
    sumBaseBalance({ accounts: [...Object.values(accountsInGroups.value), ...accountsWithoutGroups.value] }),
  );

  // Non-critical sidebar batches (portfolio roll-up summaries, venture deals) are deferred until
  // the browser is idle so above-the-fold dashboard data loads first.
  const idleEnabled = useIdleEnabled();

  // Only this roll-up observer is idle-gated. The sidebar rows observe the same query ungated,
  // so an open Portfolios section still loads its values at once.
  const { data: portfolioSummaries, isLoading: isPortfoliosTotalLoading } = usePortfolioSummaries({
    enabled: idleEnabled,
  });

  const portfoliosTotal = computed(() => {
    let total = 0;
    for (const summary of portfolioSummaries.value ?? []) {
      total += Number(summary.totalPortfolioValueInBaseCurrency);
    }
    // Portfolio values are FX-blended market estimates — holdings priced in their own currencies,
    // converted to base — so the roll-up is always approximate.
    return { total, isApprox: true };
  });

  const { data: ventureDeals } = useVentureDeals({ enabled: idleEnabled });
  const venturesCount = computed(() => (ventureDeals.value?.data ?? []).length);

  // Cars total = vehicle accounts in base currency.
  const carsTotal = computed(() => sumBaseBalance({ accounts: vehicleAccounts.value }));
  const carsCount = computed(() => vehicleAccounts.value.length);

  const { data: loans } = useLoans();
  const activeLoans = computed(() => partitionLoans({ loans: loans.value ?? [] }).active);
  const loansCount = computed(() => activeLoans.value.length);
  // Loans are liabilities (negative balances), so this total reads red like the loan rows.
  const loansTotal = computed(() => sumBaseBalance({ accounts: activeLoans.value }));

  const { sidebarSections } = useSidebarSections();

  const showPortfolios = computed(() => sidebarSections.value.portfolios);
  const venturesVisible = computed(() => sidebarSections.value.ventures && venturesCount.value > 0);
  const carsVisible = computed(() => sidebarSections.value.vehicles && carsCount.value > 0);
  const loansVisible = computed(() => sidebarSections.value.loans && loansCount.value > 0);

  return {
    accountGroups,
    isLoading,
    accountsWithoutGroups,
    vehicleAccounts,
    baseCurrencyCode,
    bankAccountsTotal,
    portfoliosTotal,
    isPortfoliosTotalLoading,
    venturesCount,
    carsTotal,
    loansTotal,
    showPortfolios,
    venturesVisible,
    carsVisible,
    loansVisible,
  };
};
