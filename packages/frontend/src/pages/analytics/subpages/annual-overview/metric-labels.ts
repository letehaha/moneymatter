import type { MetricType } from '@/common/utils/analytics-metric';

export const METRIC_LABEL_KEYS: Record<MetricType, string> = {
  expenses: 'analytics.trends.metrics.expenses',
  income: 'analytics.trends.metrics.income',
};
