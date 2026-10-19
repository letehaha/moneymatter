import {
  AI_FEATURE,
  AI_FEATURE_ENTITLEMENTS,
  BUDGET_TYPES,
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
import BudgetCategories from '@models/budget-categories.model';
import Budgets from '@models/budget.model';
import TrackerLineCategories from '@models/tracker-line-categories.model';
import TrackerLines from '@models/tracker-lines.model';
import { applyLogoWrite } from '@services/brand-logos';
import { getBudgetById } from '@services/budget.service';
import { runAfterCommit } from '@services/common/run-after-commit';
import { withTransaction } from '@services/common/with-transaction';
import { startFeatureTrial } from '@services/entitlements/start-feature-trial.service';
import { Op } from 'sequelize';

import { authorizeBudgetAccess } from './authorize-budget-access';
import { assertSmartTrackingConfig } from './smart-tracking/assert-smart-tracking-config';
import { enqueueTrackerScan, getTrackerScanState } from './smart-tracking/tracker-scan-queue';
import { assertCategoriesOwnedByUser } from './utils/assert-categories-owned-by-user';
import { expandCategoryIds } from './utils/expand-category-ids';

interface EditBudgetPayload extends EntityLogoWritePayload {
  id: RecordId;
  userId: number;
  name?: string;
  startDate?: string | null;
  endDate?: string | null;
  limitAmount?: Money | null;
  autoInclude?: boolean;
  archivePromptDismissed?: boolean;
  categoryIds?: string[];
  aiEnabled?: boolean;
  aiDescription?: string | null;
  aiPreWindowDays?: TrackerAiPreWindowDays;
}

// Forms resend the same days normalised to start/end of day; only a day change moves the scan window.
const toUtcDay = ({ date }: { date: Date | string | null }) =>
  date ? new Date(date).toISOString().slice(0, 10) : null;

const dropLineCategoriesOutsideTracker = async ({
  budgetId,
  trackerCategoryIds,
}: {
  budgetId: string;
  trackerCategoryIds: string[];
}) => {
  const lineIds = (await TrackerLines.findAll({ where: { budgetId }, attributes: ['id'] })).map((line) => line.id);
  if (!lineIds.length) return;

  await TrackerLineCategories.destroy({
    where: {
      lineId: { [Op.in]: lineIds },
      categoryId: { [Op.notIn]: trackerCategoryIds },
    },
  });

  const linesWithCategories = new Set(
    (await TrackerLineCategories.findAll({ where: { lineId: { [Op.in]: lineIds } }, attributes: ['lineId'] })).map(
      (row) => row.lineId,
    ),
  );
  const emptyLineIds = lineIds.filter((lineId) => !linesWithCategories.has(lineId));
  if (emptyLineIds.length) {
    await TrackerLines.destroy({ where: { id: { [Op.in]: emptyLineIds } } });
  }
};

export const editBudget = withTransaction(async ({ id, userId, categoryIds, ...params }: EditBudgetPayload) => {
  // Manage-level required: metadata edits (name/dates/limit/autoInclude/categories) are
  // owner / manage-only per PRD reduced-write-scope decision. `write` recipients can
  // attach their own transactions but not mutate the budget definition itself, which
  // avoids "my partner renamed my budget" / "categories list moved under me" surprises.
  const { ownerUserId, isOwner } = await authorizeBudgetAccess({
    userId,
    budgetId: id,
    requiredPermission: SHARE_PERMISSIONS.manage,
  });

  const aiFieldsSent = [params.aiEnabled, params.aiDescription, params.aiPreWindowDays].some((v) => v !== undefined);
  if (aiFieldsSent && !isOwner) {
    throw new ForbiddenError({ message: t({ key: 'budgets.smartTracking.ownerOnly' }) });
  }

  const budget = await findOrThrowNotFound({
    query: Budgets.findOne({ where: { id, userId: ownerUserId } }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const startDate = params.startDate === undefined ? budget.startDate : params.startDate;
  const endDate = params.endDate === undefined ? budget.endDate : params.endDate;
  if (startDate && endDate && new Date(startDate).getTime() > new Date(endDate).getTime()) {
    throw new ValidationError({ message: t({ key: 'budgets.startDateAfterEndDate' }) });
  }

  const aiEnabled = params.aiEnabled ?? budget.aiEnabled;
  const aiDescription = params.aiDescription === undefined ? budget.aiDescription : params.aiDescription;
  const aiPreWindowDays = params.aiPreWindowDays ?? budget.aiPreWindowDays;
  assertSmartTrackingConfig({ type: budget.type, aiEnabled, aiDescription, startDate });

  const aiChanged =
    aiEnabled !== budget.aiEnabled ||
    aiDescription !== budget.aiDescription ||
    aiPreWindowDays !== budget.aiPreWindowDays;
  const rangeChanged =
    toUtcDay({ date: startDate }) !== toUtcDay({ date: budget.startDate }) ||
    toUtcDay({ date: endDate }) !== toUtcDay({ date: budget.endDate });
  const rescan = aiEnabled && (aiChanged || rangeChanged);
  const aiTurnedOn = params.aiEnabled === true && !budget.aiEnabled;

  // A running scan writes its cursor at the end and would overwrite the reset below.
  if ((aiChanged || rescan) && (await getTrackerScanState({ budgetId: id })).status !== 'idle') {
    throw new ConflictError({ message: t({ key: 'budgets.smartTracking.scanRunning' }) });
  }

  const replaceCategories = categoryIds !== undefined && budget.type === BUDGET_TYPES.category;
  let expandedCategoryIds: string[] = [];
  if (replaceCategories) {
    // Categories are resolved against the OWNER's tree, so a `manage` recipient cannot
    // inject categories from their own tree.
    const uniqueIds = await assertCategoriesOwnedByUser({ userId: ownerUserId, categoryIds });
    expandedCategoryIds = await expandCategoryIds({ userId: ownerUserId, categoryIds: uniqueIds });
  }

  const { logoDomain, logoInitials, logoColor, logoIcon, logoImage, ...fields } = params;
  const logoPatch = await applyLogoWrite({
    write: { logoDomain, logoInitials, logoColor, logoIcon, logoImage },
    stored: budget,
  });

  await budget.update({ ...removeUndefinedKeys(fields), ...logoPatch, ...(rescan && { aiScannedUntil: null }) });
  if (aiTurnedOn) {
    await startFeatureTrial({ userId: ownerUserId, feature: AI_FEATURE_ENTITLEMENTS[AI_FEATURE.trackerMatching] });
  }
  if (rescan) await runAfterCommit({ fn: () => enqueueTrackerScan({ budgetId: id }) });

  if (replaceCategories) {
    await BudgetCategories.destroy({ where: { budgetId: id } });
    await BudgetCategories.bulkCreate(expandedCategoryIds.map((categoryId) => ({ budgetId: id, categoryId })));

    await dropLineCategoriesOutsideTracker({ budgetId: id, trackerCategoryIds: expandedCategoryIds });
  }

  return getBudgetById({ userId, id });
});
