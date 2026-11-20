export { createPeriodSerializer } from './period-serializer';
export { createEnumSerializer } from './enum-serializer';

// Session-stored Cash Flow periods. Cleared when the payday changes, so the page rebuilds them as pay periods.
export const CASH_FLOW_PERIOD_STORAGE_KEYS = ['cash-flow-period', 'cash-flow-composition-period'] as const;

// Teleport target in the analytics page header where a subpage mounts its page-level actions.
export const ANALYTICS_HEADER_ACTIONS_ID = 'analytics-header-actions';
