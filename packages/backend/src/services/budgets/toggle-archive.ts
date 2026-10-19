import { BUDGET_STATUSES, type RecordId, SHARE_PERMISSIONS } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { getBudgetById } from '@services/budget.service';
import { withTransaction } from '@services/common/with-transaction';

import { authorizeBudgetAccess } from './authorize-budget-access';

export const toggleBudgetArchive = withTransaction(
  async ({ id, userId, isArchived }: { id: RecordId; userId: number; isArchived: boolean }) => {
    // Archive/unarchive is `manage`-only — a lifecycle action, gated above routine edits
    // (and `write` doesn't include any metadata mutation per the reduced-scope decision).
    await authorizeBudgetAccess({
      userId,
      budgetId: id,
      requiredPermission: SHARE_PERMISSIONS.manage,
    });

    const budget = await findOrThrowNotFound({
      query: getBudgetById({ userId, id }),
      message: t({ key: 'budgets.budgetNotFound' }),
    });

    await budget.update({
      status: isArchived ? BUDGET_STATUSES.archived : BUDGET_STATUSES.active,
    });

    return budget;
  },
);
