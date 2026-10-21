import {
  AI_FEATURE,
  AI_FEATURE_ENTITLEMENTS,
  TRACKER_STATUSES,
  TRACKER_TYPES,
  type EntityLogoWritePayload,
  type TrackerAiPreWindowDays,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import TrackerCategories from '@models/tracker-categories.model';
import TrackerTransactions from '@models/tracker-transactions.model';
import Trackers from '@models/trackers.model';
import { findTransactions } from '@models/transactions-query';
import { applyLogoWrite } from '@services/brand-logos';
import { runAfterCommit } from '@services/common/run-after-commit';
import { withTransaction } from '@services/common/with-transaction';
import { startFeatureTrial } from '@services/entitlements/start-feature-trial.service';
import { includeCategories } from '@services/trackers/get-trackers';
import { roundToBaseCurrency } from '@services/currencies/round-to-base-currency';
import { Op } from 'sequelize';

import { assertSmartTrackingConfig } from './smart-tracking/assert-smart-tracking-config';
import { enqueueTrackerScan } from './smart-tracking/tracker-scan-queue';
import { assertCategoriesOwnedByUser } from './utils/assert-categories-owned-by-user';
import { expandCategoryIds } from './utils/expand-category-ids';

interface CreateTrackerPayload extends EntityLogoWritePayload {
  id?: string;
  userId: number;
  name: string;
  status: string;
  type?: TRACKER_TYPES;
  categoryIds?: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  autoInclude?: boolean;
  limitAmount?: Money | null;
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

const prepareTransactionFilters = (payload: CreateTrackerPayload) => ({
  userId: payload.userId,
  startDate: payload.startDate,
  endDate: payload.endDate,
  autoInclude: payload.autoInclude,
});

export const createTracker = withTransaction(async (payload: CreateTrackerPayload) => {
  const trackerType = payload.type ?? TRACKER_TYPES.manual;
  const aiEnabled = payload.aiEnabled ?? false;
  assertSmartTrackingConfig({
    type: trackerType,
    aiEnabled,
    aiDescription: payload.aiDescription,
    startDate: payload.startDate,
  });

  const categoryIds =
    trackerType === TRACKER_TYPES.category && payload.categoryIds?.length
      ? await assertCategoriesOwnedByUser({ userId: payload.userId, categoryIds: payload.categoryIds })
      : [];

  const logoPatch = await applyLogoWrite({
    write: {
      logoDomain: payload.logoDomain,
      logoInitials: payload.logoInitials,
      logoColor: payload.logoColor,
      logoIcon: payload.logoIcon,
      logoImage: payload.logoImage,
    },
  });

  // A tracker is denominated in the owner's base currency.
  const [limitAmount] = await roundToBaseCurrency({ userId: payload.userId, values: [payload.limitAmount] });

  const tracker = await Trackers.create({
    name: payload.name,
    userId: payload.userId,
    status: payload.status || TRACKER_STATUSES.active,
    type: trackerType,
    startDate: payload.startDate || null,
    endDate: payload.endDate || null,
    autoInclude: payload.autoInclude ?? false,
    limitAmount: limitAmount ?? null,
    aiEnabled,
    aiDescription: payload.aiDescription ?? null,
    ...(payload.aiPreWindowDays !== undefined && { aiPreWindowDays: payload.aiPreWindowDays }),
    ...logoPatch,
  });
  if (aiEnabled) {
    await startFeatureTrial({
      userId: payload.userId,
      feature: AI_FEATURE_ENTITLEMENTS[AI_FEATURE.trackerMatching],
    });
    await runAfterCommit({ fn: () => enqueueTrackerScan({ trackerId: tracker.id }) });
  }

  // For category-based trackers, create TrackerCategories entries
  if (categoryIds.length) {
    // Expand parent categories to include children
    const expandedCategoryIds = await expandCategoryIds({
      userId: payload.userId,
      categoryIds,
    });

    if (expandedCategoryIds.length) {
      await TrackerCategories.bulkCreate(
        expandedCategoryIds.map((categoryId) => ({
          trackerId: tracker.id,
          categoryId,
        })),
      );
    }
  }

  // For manual trackers with autoInclude, link transactions by date range
  if (trackerType === TRACKER_TYPES.manual && payload.autoInclude && payload.startDate && payload.endDate) {
    const transactionFilters = prepareTransactionFilters(payload);
    const transactions = await findTransactions({
      planned: 'exclude',
      access: { creator: transactionFilters.userId },
      balanceAdjustments: 'include',
      completeness: 'all',
      where: {
        time: {
          [Op.between]: [transactionFilters.startDate, transactionFilters.endDate],
        },
      },
      attributes: ['id'],
    });

    if (transactions.length) {
      const transactionIds = transactions.map((tx) => tx.id);
      await TrackerTransactions.bulkCreate(
        transactionIds.map((transactionId) => ({
          trackerId: tracker.id,
          transactionId,
        })),
      );
    }
  }

  // Reload tracker with categories for category-based trackers
  const reloadedTracker = await Trackers.findByPk(tracker.id, {
    attributes: { exclude: ['userId'] },
    include: trackerType === TRACKER_TYPES.category ? [includeCategories] : [],
  });

  return reloadedTracker!;
});
