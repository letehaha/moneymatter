import { getPivotReport } from '@/api';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import type { Period } from '@/composable/use-period-navigation';
import type { PivotRowDimension, PivotGranularity, PivotMeasure, SavedPivotViewConfig } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { format } from 'date-fns';
import { type ComputedRef, computed } from 'vue';

/** The live, in-memory Pivot config the UI edits (period as Date objects). The
 * persisted saved-view form (`SavedPivotViewConfig`) mirrors this with the
 * period flattened to `yyyy-MM-dd` strings. */
export interface PivotLiveConfig {
  rowDimension: PivotRowDimension;
  granularity: PivotGranularity;
  measure: PivotMeasure;
  period: Period;
  accountIds: string[];
  categoryIds: string[];
  payeeIds: string[];
  heatmap: boolean;
  showDelta: boolean;
}

const formatDate = (date: Date): string => format(date, 'yyyy-MM-dd');

/** Flatten a live config into the persistable saved-view form (empty id arrays
 * collapse to `undefined` so equality checks stay stable). */
export const buildSavedPivotConfig = ({ config }: { config: PivotLiveConfig }): SavedPivotViewConfig => ({
  rowDimension: config.rowDimension,
  granularity: config.granularity,
  measure: config.measure,
  from: formatDate(config.period.from),
  to: formatDate(config.period.to),
  accountIds: config.accountIds.length ? config.accountIds : undefined,
  categoryIds: config.categoryIds.length ? config.categoryIds : undefined,
  payeeIds: config.payeeIds.length ? config.payeeIds : undefined,
  heatmap: config.heatmap,
  showDelta: config.showDelta,
});

export const usePivotReport = ({ config }: { config: ComputedRef<PivotLiveConfig> }) => {
  const queryParams = computed(() => ({
    from: config.value.period.from,
    to: config.value.period.to,
    granularity: config.value.granularity,
    rowDimension: config.value.rowDimension,
    measure: config.value.measure,
    accountIds: config.value.accountIds,
    categoryIds: config.value.categoryIds,
    payeeIds: config.value.payeeIds,
  }));

  const query = useQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsPivotReport, queryParams],
    queryFn: () => getPivotReport(queryParams.value),
    staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
    gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  });

  return { query };
};
