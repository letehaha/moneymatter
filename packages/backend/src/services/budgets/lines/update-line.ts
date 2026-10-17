import { SHARE_PERMISSIONS } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { removeUndefinedKeys } from '@js/helpers';
import { withTransaction } from '@services/common/with-transaction';

import { authorizeBudgetAccess } from '../authorize-budget-access';
import { findLineOrThrow, replaceLineCategories } from './line-helpers';

export const updateTrackerLine = withTransaction(
  async ({
    userId,
    budgetId,
    lineId,
    categoryIds,
    ...fields
  }: {
    userId: number;
    budgetId: string;
    lineId: string;
    name?: string;
    limitAmount?: Money | null;
    categoryIds?: string[];
    position?: number;
  }) => {
    const { ownerUserId } = await authorizeBudgetAccess({
      userId,
      budgetId,
      requiredPermission: SHARE_PERMISSIONS.manage,
    });

    const line = await findLineOrThrow({ budgetId, lineId });

    await line.update(removeUndefinedKeys(fields));

    if (categoryIds !== undefined) {
      await replaceLineCategories({ budgetId, lineId, ownerUserId, categoryIds });
    }

    return findLineOrThrow({ budgetId, lineId });
  },
);
