import { BUDGET_STATUSES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Budgets from '@models/budget.model';
import { includeLines } from '@services/budget.service';
import { withTransaction } from '@services/common/with-transaction';

import { authorizeBudgetAccess } from './authorize-budget-access';

export const toggleBudgetArchive = withTransaction(
  async ({ id, userId, isArchived }: { id: string; userId: number; isArchived: boolean }) => {
    // Archive/unarchive is `manage`-only — a lifecycle action, gated above routine edits
    // (and `write` doesn't include any metadata mutation per the reduced-scope decision).
    const { ownerUserId } = await authorizeBudgetAccess({
      userId,
      budgetId: id,
      requiredPermission: SHARE_PERMISSIONS.manage,
    });

    const budget = await findOrThrowNotFound({
      query: Budgets.findOne({ where: { id, userId: ownerUserId }, include: [includeLines] }),
      message: t({ key: 'budgets.budgetNotFound' }),
    });

    await budget.update({
      status: isArchived ? BUDGET_STATUSES.archived : BUDGET_STATUSES.active,
    });

    return budget;
  },
);
