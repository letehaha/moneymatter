import { TRACKER_STATUSES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ForbiddenError } from '@js/errors';
import Categories from '@models/categories.model';
import TrackerLineCategories from '@models/tracker-line-categories.model';
import TrackerLines from '@models/tracker-lines.model';
import Trackers from '@models/trackers.model';
import { LOGO_FIELD_KEYS } from '@services/brand-logos/apply-manual-logo-patch';
import { withTransaction } from '@services/common/with-transaction';
import { copyLogoImageIfPresent } from '@services/logo-images/logo-images.service';
import { getTrackerById, includeTags } from '@services/trackers/get-trackers';
import pick from 'lodash/pick';

import { authorizeTrackerAccess } from './authorize-tracker-access';
import { saveTrackerRules } from './rules/save-tracker-rules';

// Sequelize mutates include objects while resolving them, so each nesting level needs its own instance.
const includeCategoryIds = () => ({
  model: Categories,
  as: 'categories',
  attributes: ['id'],
  through: { attributes: [] },
});

const COPY_SUFFIX = ' copy';
const MAX_NAME_LENGTH = 200;

export const duplicateTracker = withTransaction(async ({ userId, id }: { userId: number; id: string }) => {
  const { isOwner } = await authorizeTrackerAccess({
    userId,
    trackerId: id,
    requiredPermission: SHARE_PERMISSIONS.read,
  });
  if (!isOwner) {
    throw new ForbiddenError({ message: t({ key: 'budgets.onlyOwnerCanDuplicate' }) });
  }

  const source = await findOrThrowNotFound({
    query: Trackers.findOne({
      where: { id, userId },
      include: [
        includeCategoryIds(),
        includeTags,
        { model: TrackerLines, as: 'lines', include: [includeCategoryIds()] },
      ],
    }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const copy = await Trackers.create({
    name: `${source.name.slice(0, MAX_NAME_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
    userId,
    status: TRACKER_STATUSES.active,
    limitAmount: source.limitAmount,
    limitKind: source.limitKind,
    startDate: null,
    endDate: null,
    rulesEnabled: source.rulesEnabled,
    rulesCleanup: source.rulesCleanup,
    archivePromptDismissed: false,
    aiEnabled: false,
    aiDescription: source.aiDescription,
    aiPreWindowDays: source.aiPreWindowDays,
    ...pick(source, LOGO_FIELD_KEYS),
    logoImageId: await copyLogoImageIfPresent({ id: source.logoImageId }),
  });

  await saveTrackerRules({
    trackerId: copy.id,
    ownerUserId: userId,
    rulesEnabled: copy.rulesEnabled,
    categoryIds: source.categories.map((category) => category.id),
    tagIds: source.tags.map((tag) => tag.id),
  });

  const sourceLines = source.lines ?? [];
  const copiedLines = await TrackerLines.bulkCreate(
    sourceLines.map((line) => ({
      trackerId: copy.id,
      name: line.name,
      limitAmount: line.limitAmount,
      position: line.position,
    })),
  );
  await TrackerLineCategories.bulkCreate(
    sourceLines.flatMap((line, index) =>
      line.categories.map((category) => ({ lineId: copiedLines[index]!.id, categoryId: category.id })),
    ),
  );

  return findOrThrowNotFound({
    query: getTrackerById({ userId, id: copy.id }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });
});
