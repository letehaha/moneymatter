/**
 * Tracker Serializers
 *
 * Serializes tracker model instances for API responses.
 * Money fields auto-convert via .toNumber().
 * Deserializers convert API decimal inputs to Money.
 */
import {
  TRACKER_TYPES,
  type TrackerSpendingByCategoryItem,
  type TrackerSpendingStatsResponse,
  type TrackerStatsResponse,
  type EntityLogoFields,
  ResourceShareInfo,
} from '@bt/shared/types';
import { Money, centsToApiDecimal, moneyToApiDecimalOrNull } from '@common/types/money';
import type Categories from '@models/categories.model';
import type TrackerLines from '@models/tracker-lines.model';
import type Trackers from '@models/trackers.model';
import type { TrackerShareContext } from '@services/sharing/get-shared-trackers.service';
import type { SpendingStatsResponse } from '@services/trackers/spending-stats';
import type { StatsResponse } from '@services/trackers/stats';

import { serializeLogoFields } from './logo-fields.serializer';

// ============================================================================
// Response Types
// ============================================================================

interface TrackerCategoryResponse {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
}

interface TrackerApiResponse extends EntityLogoFields {
  id: string;
  userId: number;
  name: string;
  status: string;
  type: TRACKER_TYPES;
  startDate: Date | null;
  endDate: Date | null;
  autoInclude: boolean;
  limitAmount: number | null;
  archivePromptDismissed: boolean;
  aiEnabled: boolean;
  aiDescription: string | null;
  aiPreWindowDays: number;
  aiLastScannedAt: Date | null;
  categories: TrackerCategoryResponse[];
  lines: TrackerLineResponse[];
  /** Present on user-facing list/detail responses when share context is attached. */
  share?: ResourceShareInfo;
}

interface TrackerLineResponse {
  id: string;
  trackerId: string;
  name: string;
  limitAmount: number | null;
  position: number;
  categories: TrackerCategoryResponse[];
}

// ============================================================================
// Serializers (DB → API)
// ============================================================================

const serializeEmbeddedCategories = (categories: Categories[] | undefined): TrackerCategoryResponse[] =>
  (categories || []).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    parentId: c.parentId,
  }));

export function serializeTrackerLine(line: TrackerLines): TrackerLineResponse {
  return {
    id: line.id,
    trackerId: line.trackerId,
    name: line.name,
    limitAmount: centsToApiDecimalOrNull(line.limitAmount),
    position: line.position,
    categories: serializeEmbeddedCategories(line.categories),
  };
}

/**
 * Serialize a tracker from DB format to API response
 */
export function serializeTracker(tracker: Trackers & { _shareContext?: TrackerShareContext }): TrackerApiResponse {
  const categories = serializeEmbeddedCategories(tracker.categories);
  // Smart tracking is owner-only; its description and scan state are not for recipients.
  const isRecipient = tracker._shareContext !== undefined && !tracker._shareContext.isOwner;

  const response: TrackerApiResponse = {
    id: tracker.id,
    userId: tracker.userId,
    name: tracker.name,
    status: tracker.status,
    type: tracker.type,
    startDate: tracker.startDate,
    endDate: tracker.endDate,
    autoInclude: tracker.autoInclude,
    limitAmount: moneyToApiDecimalOrNull(tracker.limitAmount),
    archivePromptDismissed: tracker.archivePromptDismissed,
    aiEnabled: isRecipient ? false : tracker.aiEnabled,
    aiDescription: isRecipient ? null : tracker.aiDescription,
    aiPreWindowDays: tracker.aiPreWindowDays,
    aiLastScannedAt: isRecipient ? null : tracker.aiLastScannedAt,
    ...serializeLogoFields({ entity: tracker }),
    categories,
    lines: (tracker.lines || []).map(serializeTrackerLine),
  };

  if (tracker._shareContext) {
    response.share = {
      isOwner: tracker._shareContext.isOwner,
      owner: tracker._shareContext.owner,
      permission: tracker._shareContext.permission,
      policy: tracker._shareContext.policy,
      accessSource: tracker._shareContext.accessSource,
    };
  }

  return response;
}

/**
 * Serialize multiple trackers
 */
export function serializeTrackers(
  trackers: Array<Trackers & { _shareContext?: TrackerShareContext }>,
): TrackerApiResponse[] {
  return trackers.map(serializeTracker);
}

// ============================================================================
// Tracker Stats Serializer
// ============================================================================

/**
 * Serialize tracker stats to API decimal format
 */
export function serializeTrackerStats(stats: StatsResponse): TrackerStatsResponse {
  return {
    summary: {
      actualIncome: centsToApiDecimal(stats.summary.actualIncome),
      actualExpense: centsToApiDecimal(stats.summary.actualExpense),
      balance: centsToApiDecimal(stats.summary.balance),
      utilizationRate: stats.summary.utilizationRate,
      transactionsCount: stats.summary.transactionsCount,
      firstTransactionDate: stats.summary.firstTransactionDate,
      lastTransactionDate: stats.summary.lastTransactionDate,
    },
    lines: stats.lines.map((line) => ({ lineId: line.lineId, spent: centsToApiDecimal(line.spent) })),
    otherSpent: centsToApiDecimal(stats.otherSpent),
  };
}

// ============================================================================
// Tracker Spending Stats Serializer
// ============================================================================

function serializeSpendingCategory(
  item: SpendingStatsResponse['spendingsByCategory'][number],
): TrackerSpendingByCategoryItem {
  return {
    categoryId: item.categoryId,
    name: item.name,
    color: item.color,
    amount: centsToApiDecimal(item.amount),
    ...(item.children?.length && {
      children: item.children.map(serializeSpendingCategory),
    }),
  };
}

export function serializeTrackerSpendingStats(stats: SpendingStatsResponse): TrackerSpendingStatsResponse {
  return {
    spendingsByCategory: stats.spendingsByCategory.map(serializeSpendingCategory),
    spendingOverTime: {
      granularity: stats.spendingOverTime.granularity,
      periods: stats.spendingOverTime.periods.map((period) => ({
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        expense: centsToApiDecimal(period.expense),
        income: centsToApiDecimal(period.income),
      })),
    },
    spendingsByCurrency: stats.spendingsByCurrency.map((item) => ({
      currencyCode: item.currencyCode,
      amount: centsToApiDecimal(item.amount),
      refAmount: centsToApiDecimal(item.refAmount),
    })),
    topPayees: stats.topPayees.map((payee) => ({ ...payee, amount: centsToApiDecimal(payee.amount) })),
    biggestDay: stats.biggestDay && {
      date: stats.biggestDay.date,
      expense: centsToApiDecimal(stats.biggestDay.expense),
    },
  };
}
