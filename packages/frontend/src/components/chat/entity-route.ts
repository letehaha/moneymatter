import { ROUTES_NAMES } from '@/routes/constants';
import type { ChatEntityKind, ChatEntityRef } from '@bt/shared/types';
import type { RouteLocationRaw } from 'vue-router';

/** The entities that have a page of their own: the route and the param that holds the id. */
const ENTITY_ROUTES: Readonly<Partial<Record<ChatEntityKind, { name: string; param: string }>>> = {
  account: { name: ROUTES_NAMES.account, param: 'id' },
  vehicle: { name: ROUTES_NAMES.accountsVehicleDetails, param: 'id' },
  loan: { name: ROUTES_NAMES.loanDetail, param: 'id' },
  portfolio: { name: ROUTES_NAMES.portfolioDetail, param: 'portfolioId' },
  ventureDeal: { name: ROUTES_NAMES.ventureDealDetail, param: 'dealId' },
  budgetPlan: { name: ROUTES_NAMES.budgetPlan, param: 'planId' },
  subscription: { name: ROUTES_NAMES.plannedSubscriptionDetails, param: 'id' },
  tracker: { name: ROUTES_NAMES.plannedTrackerDetails, param: 'id' },
  payee: { name: ROUTES_NAMES.settingsPayeeDetail, param: 'id' },
  transactionAutomation: { name: ROUTES_NAMES.automationDetails, param: 'id' },
};

/** Where an entity reference leads, or `null` when the entity has no page to open. */
export const chatEntityRoute = ({ entity }: { entity: ChatEntityRef }): RouteLocationRaw | null => {
  const route = ENTITY_ROUTES[entity.kind];
  if (!route) return null;

  return { name: route.name, params: { [route.param]: entity.id } };
};
