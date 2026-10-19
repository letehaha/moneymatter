import { SHARE_PERMISSIONS } from '@bt/shared/types';
import { withTransaction } from '@services/common/with-transaction';

import { authorizeBudgetAccess } from '../authorize-budget-access';
import { findLineOrThrow } from './line-helpers';

export const deleteTrackerLine = withTransaction(
  async ({ userId, budgetId, lineId }: { userId: number; budgetId: string; lineId: string }) => {
    await authorizeBudgetAccess({ userId, budgetId, requiredPermission: SHARE_PERMISSIONS.manage });

    const line = await findLineOrThrow({ budgetId, lineId });
    await line.destroy();
  },
);
