import { type FiltersStruct } from '@/components/records-filters/const';
import { FILTER_REGISTRY } from '@/components/records-filters/filter-registry';
import { trackAnalyticsEvent } from '@/lib/posthog';

/**
 * Fires `transactions_filter_used` for every filter that just transitioned from
 * its default to a narrowing value. Edge-triggered, so typing "abc" into the
 * search box reports once, not per keystroke. The analytics `filter` property
 * is the filter's registry key.
 */
export function trackNewlyActiveFilters({ previous, current }: { previous: FiltersStruct; current: FiltersStruct }) {
  for (const [filter, definition] of Object.entries(FILTER_REGISTRY)) {
    if (definition.isActive(current) && !definition.isActive(previous)) {
      trackAnalyticsEvent({ event: 'transactions_filter_used', properties: { filter } });
    }
  }
}
