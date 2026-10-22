import {
  AI_FEATURE,
  AI_FEATURE_ENTITLEMENTS,
  type EntityLogoWritePayload,
  type RecordId,
  SHARE_PERMISSIONS,
  type TrackerAiPreWindowDays,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError, ForbiddenError, ValidationError } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import Trackers from '@models/trackers.model';
import { applyLogoWrite } from '@services/brand-logos';
import { runAfterCommit } from '@services/common/run-after-commit';
import { withTransaction } from '@services/common/with-transaction';
import { startFeatureTrial } from '@services/entitlements/start-feature-trial.service';
import { getTrackerById } from '@services/trackers/get-trackers';

import { authorizeTrackerAccess } from './authorize-tracker-access';
import { saveTrackerRules } from './rules/save-tracker-rules';
import { assertSmartTrackingConfig } from './smart-tracking/assert-smart-tracking-config';
import { enqueueTrackerScan, getTrackerScanState } from './smart-tracking/tracker-scan-queue';

interface EditTrackerPayload extends EntityLogoWritePayload {
  id: RecordId;
  userId: number;
  name?: string;
  startDate?: string | null;
  endDate?: string | null;
  limitAmount?: Money | null;
  archivePromptDismissed?: boolean;
  categoryIds?: string[];
  tagIds?: string[];
  rulesEnabled?: boolean;
  rulesCleanup?: boolean;
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

// Forms resend the same days normalised to start/end of day; only a day change moves the scan window.
const toUtcDay = ({ date }: { date: Date | string | null }) =>
  date ? new Date(date).toISOString().slice(0, 10) : null;

export const editTracker = withTransaction(
  async ({ id, userId, categoryIds, tagIds, ...params }: EditTrackerPayload) => {
    // Manage-level required: metadata edits (name/dates/limit/rules) are
    // owner / manage-only per PRD reduced-write-scope decision. `write` recipients can
    // attach their own transactions but not mutate the tracker definition itself, which
    // avoids "my partner renamed my tracker" / "rules moved under me" surprises.
    const { ownerUserId, isOwner } = await authorizeTrackerAccess({
      userId,
      trackerId: id,
      requiredPermission: SHARE_PERMISSIONS.manage,
    });

    const aiFieldsSent = [params.aiEnabled, params.aiDescription, params.aiPreWindowDays].some((v) => v !== undefined);
    if (aiFieldsSent && !isOwner) {
      throw new ForbiddenError({ message: t({ key: 'budgets.smartTracking.ownerOnly' }) });
    }

    const tracker = await findOrThrowNotFound({
      query: Trackers.findOne({ where: { id, userId: ownerUserId } }),
      message: t({ key: 'budgets.budgetNotFound' }),
    });

    const startDate = params.startDate === undefined ? tracker.startDate : params.startDate;
    const endDate = params.endDate === undefined ? tracker.endDate : params.endDate;
    if (startDate && endDate && new Date(startDate).getTime() > new Date(endDate).getTime()) {
      throw new ValidationError({ message: t({ key: 'budgets.startDateAfterEndDate' }) });
    }

    const aiEnabled = params.aiEnabled ?? tracker.aiEnabled;
    const aiDescription = params.aiDescription === undefined ? tracker.aiDescription : params.aiDescription;
    const aiPreWindowDays = params.aiPreWindowDays ?? tracker.aiPreWindowDays;
    assertSmartTrackingConfig({ aiEnabled, aiDescription, startDate });

    const aiChanged =
      aiEnabled !== tracker.aiEnabled ||
      aiDescription !== tracker.aiDescription ||
      aiPreWindowDays !== tracker.aiPreWindowDays;
    const rangeChanged =
      toUtcDay({ date: startDate }) !== toUtcDay({ date: tracker.startDate }) ||
      toUtcDay({ date: endDate }) !== toUtcDay({ date: tracker.endDate });
    const rescan = aiEnabled && (aiChanged || rangeChanged);
    const aiTurnedOn = params.aiEnabled === true && !tracker.aiEnabled;

    // A running scan writes its cursor at the end and would overwrite the reset below.
    if ((aiChanged || rescan) && (await getTrackerScanState({ trackerId: id })).status !== 'idle') {
      throw new ConflictError({ message: t({ key: 'budgets.smartTracking.scanRunning' }) });
    }

    const { logoDomain, logoInitials, logoColor, logoIcon, logoImage, ...fields } = params;
    const logoPatch = await applyLogoWrite({
      write: { logoDomain, logoInitials, logoColor, logoIcon, logoImage },
      stored: tracker,
    });

    await tracker.update({ ...removeUndefinedKeys(fields), ...logoPatch, ...(rescan && { aiScannedUntil: null }) });
    if (aiTurnedOn) {
      await startFeatureTrial({ userId: ownerUserId, feature: AI_FEATURE_ENTITLEMENTS[AI_FEATURE.trackerMatching] });
    }
    if (rescan) await runAfterCommit({ fn: () => enqueueTrackerScan({ trackerId: id }) });

    const rulesInputSent = [categoryIds, tagIds, params.rulesEnabled, params.rulesCleanup].some((v) => v !== undefined);
    if (rulesInputSent || rangeChanged) {
      // Categories and tags resolve against the OWNER's data, so a `manage` recipient cannot inject their own.
      await saveTrackerRules({ trackerId: id, ownerUserId, rulesEnabled: tracker.rulesEnabled, categoryIds, tagIds });
    }

    return getTrackerById({ userId, id });
  },
);
