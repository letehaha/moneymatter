import { SHARE_PERMISSIONS } from '@bt/shared/types';
import { Money } from '@common/types/money';
import TrackerLines from '@models/tracker-lines.model';
import { withTransaction } from '@services/common/with-transaction';

import { authorizeBudgetAccess } from '../authorize-budget-access';
import { findLineOrThrow, replaceLineCategories } from './line-helpers';

export const createTrackerLine = withTransaction(
  async ({
    userId,
    budgetId,
    name,
    limitAmount,
    categoryIds,
    position,
  }: {
    userId: number;
    budgetId: string;
    name: string;
    limitAmount?: Money | null;
    categoryIds: string[];
    position?: number;
  }) => {
    const { ownerUserId } = await authorizeBudgetAccess({
      userId,
      budgetId,
      requiredPermission: SHARE_PERMISSIONS.manage,
    });

    const maxPosition = await TrackerLines.max<number | null, TrackerLines>('position', { where: { budgetId } });

    const line = await TrackerLines.create({
      budgetId,
      name,
      limitAmount: limitAmount ?? null,
      position: position ?? (maxPosition ?? -1) + 1,
    });

    await replaceLineCategories({ budgetId, lineId: line.id, ownerUserId, categoryIds });

    return findLineOrThrow({ budgetId, lineId: line.id });
  },
);
