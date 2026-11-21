import { METRICS, type MetricType } from '@/common/utils/analytics-metric';
import type { Period } from '@/composable/use-period-navigation';
import { ROUTES_NAMES } from '@/routes/constants';
import { isAfter, isValid, parseISO } from 'date-fns';
import type { LocationQuery, LocationQueryValue, RouteLocationRaw } from 'vue-router';

type QueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

const DEEP_LINK_KEYS = ['categoryIds', 'excludedCategoryIds', 'metric', 'from', 'to'] as const;
type DeepLinkKey = (typeof DEEP_LINK_KEYS)[number];

const isDeepLinkKey = (key: string): key is DeepLinkKey => (DEEP_LINK_KEYS as readonly string[]).includes(key);

export type TrendsLocationInput = (
  | { categoryIds?: string[]; excludedCategoryIds?: never }
  | { categoryIds?: never; excludedCategoryIds?: string[] }
) & {
  metric?: MetricType;
  period?: Period;
};

export interface TrendsDeepLink {
  categoryIds: string[];
  excludedCategoryIds: string[];
  metric?: MetricType;
  period?: Period;
  restQuery: LocationQuery;
}

/**
 * A link with `metric` presets the whole Trends view (other filters reset);
 * without it the link only rescopes the categories.
 */
export const buildTrendsLocation = (input: TrendsLocationInput = {}): RouteLocationRaw => {
  const query: Record<DeepLinkKey, string | string[] | undefined> = {
    categoryIds: input.categoryIds?.length ? input.categoryIds : undefined,
    excludedCategoryIds: input.excludedCategoryIds?.length ? input.excludedCategoryIds : undefined,
    metric: input.metric,
    from: input.period?.from.toISOString(),
    to: input.period?.to.toISOString(),
  };

  return {
    name: ROUTES_NAMES.analyticsTrendsComparison,
    query: Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)),
  };
};

const toIds = ({ value }: { value: QueryValue }) =>
  (Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === 'string' && id.length > 0);

const first = ({ value }: { value: QueryValue }) => {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === 'string' ? item : undefined;
};

const parseDateParam = ({ value }: { value: QueryValue }) => {
  const raw = first({ value });
  const date = raw ? parseISO(raw) : undefined;
  return date && isValid(date) ? date : undefined;
};

export const readTrendsDeepLink = ({ query }: { query: LocationQuery }): TrendsDeepLink | null => {
  if (!Object.keys(query).some(isDeepLinkKey)) return null;

  const { categoryIds, excludedCategoryIds, metric, from, to }: Partial<Record<DeepLinkKey, QueryValue>> = query;
  const rawMetric = first({ value: metric });
  const fromDate = parseDateParam({ value: from });
  const toDate = parseDateParam({ value: to });

  return {
    categoryIds: toIds({ value: categoryIds }),
    excludedCategoryIds: toIds({ value: excludedCategoryIds }),
    metric: METRICS.find((item) => item === rawMetric),
    period: fromDate && toDate && !isAfter(fromDate, toDate) ? { from: fromDate, to: toDate } : undefined,
    restQuery: Object.fromEntries(Object.entries(query).filter(([key]) => !isDeepLinkKey(key))),
  };
};
