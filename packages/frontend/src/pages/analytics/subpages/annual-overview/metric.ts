import { TRANSACTION_TYPES } from '@bt/shared/types';

export const METRICS = ['expenses', 'income'] as const;
export type MetricType = (typeof METRICS)[number];

export const METRIC_LABEL_KEYS: Record<MetricType, string> = {
  expenses: 'analytics.trends.metrics.expenses',
  income: 'analytics.trends.metrics.income',
};

export const metricTransactionType = ({ metric }: { metric: MetricType }) =>
  metric === 'income' ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense;

export const isGoodChange = ({ metric, change }: { metric: MetricType; change: number }): boolean =>
  metric === 'expenses' ? change < 0 : change > 0;

/** Rounded percent change; undefined without a base to compare against. */
export const percentChange = ({ current, previous }: { current: number; previous: number }): number | undefined =>
  previous === 0 ? undefined : Math.round(((current - previous) / Math.abs(previous)) * 100);
