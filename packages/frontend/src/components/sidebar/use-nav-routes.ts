import { computed } from 'vue';
import { useRoute } from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    /** Top-level sidebar group this route highlights. Inherited from parent routes. */
    navSection?: 'accounts' | 'transactions' | 'budget' | 'planned';
  }
}

/** Which top-level nav group the current route belongs to, shared by the full nav and the rail. */
export const useSidebarNavRoutes = () => {
  const route = useRoute();

  const isAccountsRoute = computed(() => route.meta.navSection === 'accounts');
  const isTransactionsRoute = computed(() => route.meta.navSection === 'transactions');
  const isBudgetRoute = computed(() => route.meta.navSection === 'budget');
  const isPlannedRoute = computed(() => route.meta.navSection === 'planned');

  return { isAccountsRoute, isTransactionsRoute, isBudgetRoute, isPlannedRoute };
};
