import { SHARE_PERMISSIONS } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { removeUndefinedKeys } from '@js/helpers';
import { withTransaction } from '@services/common/with-transaction';

import { authorizeTrackerAccess } from '../authorize-tracker-access';
import { findLineOrThrow, replaceLineCategories } from './line-helpers';

export const updateTrackerLine = withTransaction(
  async ({
    userId,
    trackerId,
    lineId,
    categoryIds,
    ...fields
  }: {
    userId: number;
    trackerId: string;
    lineId: string;
    name?: string;
    limitAmount?: Money | null;
    categoryIds?: string[];
    position?: number;
  }) => {
    const { ownerUserId } = await authorizeTrackerAccess({
      userId,
      trackerId,
      requiredPermission: SHARE_PERMISSIONS.manage,
    });

    const line = await findLineOrThrow({ trackerId, lineId });

    await line.update(removeUndefinedKeys(fields));

    if (categoryIds !== undefined) {
      await replaceLineCategories({ lineId, ownerUserId, categoryIds });
    }

    return findLineOrThrow({ trackerId, lineId });
  },
);
