import {
  AI_FEATURE,
  AI_FEATURE_ENTITLEMENTS,
  TRACKER_STATUSES,
  type EntityLogoWritePayload,
  type TrackerAiPreWindowDays,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import Trackers from '@models/trackers.model';
import { applyLogoWrite } from '@services/brand-logos';
import { runAfterCommit } from '@services/common/run-after-commit';
import { withTransaction } from '@services/common/with-transaction';
import { startFeatureTrial } from '@services/entitlements/start-feature-trial.service';
import { includeCategories, includeTags } from '@services/trackers/get-trackers';

import { saveTrackerRules } from './rules/save-tracker-rules';
import { assertSmartTrackingConfig } from './smart-tracking/assert-smart-tracking-config';
import { enqueueTrackerScan } from './smart-tracking/tracker-scan-queue';

interface CreateTrackerPayload extends EntityLogoWritePayload {
  id?: string;
  userId: number;
  name: string;
  status: string;
  categoryIds?: string[];
  tagIds?: string[];
  rulesEnabled?: boolean;
  rulesCleanup?: boolean;
  startDate?: Date | null;
  endDate?: Date | null;
  limitAmount?: Money | null;
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

export const createTracker = withTransaction(async (payload: CreateTrackerPayload) => {
  const aiEnabled = payload.aiEnabled ?? false;
  const rulesEnabled = payload.rulesEnabled ?? false;
  assertSmartTrackingConfig({ aiEnabled, aiDescription: payload.aiDescription, startDate: payload.startDate });

  const logoPatch = await applyLogoWrite({
    write: {
      logoDomain: payload.logoDomain,
      logoInitials: payload.logoInitials,
      logoColor: payload.logoColor,
      logoIcon: payload.logoIcon,
      logoImage: payload.logoImage,
    },
  });

  const tracker = await Trackers.create({
    name: payload.name,
    userId: payload.userId,
    status: payload.status || TRACKER_STATUSES.active,
    startDate: payload.startDate || null,
    endDate: payload.endDate || null,
    limitAmount: payload.limitAmount ?? null,
    rulesEnabled,
    ...(payload.rulesCleanup !== undefined && { rulesCleanup: payload.rulesCleanup }),
    aiEnabled,
    aiDescription: payload.aiDescription ?? null,
    ...(payload.aiPreWindowDays !== undefined && { aiPreWindowDays: payload.aiPreWindowDays }),
    ...logoPatch,
  });

  // Before the AI scan is queued, so the AI skips what rules already linked.
  await saveTrackerRules({
    trackerId: tracker.id,
    ownerUserId: payload.userId,
    rulesEnabled,
    categoryIds: payload.categoryIds,
    tagIds: payload.tagIds,
  });

  if (aiEnabled) {
    await startFeatureTrial({
      userId: payload.userId,
      feature: AI_FEATURE_ENTITLEMENTS[AI_FEATURE.trackerMatching],
    });
    await runAfterCommit({ fn: () => enqueueTrackerScan({ trackerId: tracker.id }) });
  }

  const reloadedTracker = await Trackers.findByPk(tracker.id, {
    attributes: { exclude: ['userId'] },
    include: [includeCategories, includeTags],
  });

  return reloadedTracker!;
});
