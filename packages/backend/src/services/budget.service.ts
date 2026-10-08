import { BUDGET_STATUSES, BudgetModel } from '@bt/shared/types';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import Tags from '@models/tags.model';
import Users from '@models/users.model';
import { Op } from 'sequelize';

import { withTransaction } from './common/with-transaction';
import {
  BudgetShareContext,
  buildOwnerBudgetShareContext,
  getSharedBudgetById,
  getSharedBudgetsForUser,
} from './sharing/get-shared-budgets.service';

type BudgetWithCategories = Budgets & {
  categories: Pick<Categories, 'id' | 'name' | 'color' | 'parentId'>[];
  tags: Pick<Tags, 'id' | 'name' | 'color' | 'icon'>[];
};

type BudgetWithShareContext = BudgetWithCategories & { _shareContext?: BudgetShareContext };

const includeCategories = {
  model: Categories,
  as: 'categories',
  attributes: ['id', 'name', 'color', 'parentId'],
};

const includeTags = {
  model: Tags,
  as: 'tags',
  attributes: ['id', 'name', 'color', 'icon'],
};

const filterByStatus = ({ statuses }: { statuses?: BUDGET_STATUSES[] }) =>
  statuses?.length ? { status: { [Op.in]: statuses } } : {};

/**
 * Returns every budget the caller can read: budgets they own (with an owner share
 * context) merged with budgets shared with them (with a recipient share context).
 *
 * Status filter and category hydration are pushed down into both halves so the shared
 * branch loads in a single query instead of re-fetching post-load.
 */
export const getBudgets = withTransaction(
  async ({ userId, statuses }: { userId: number; statuses?: BUDGET_STATUSES[] }): Promise<BudgetWithShareContext[]> => {
    const statusWhere = filterByStatus({ statuses });
    const [ownedBudgets, sharedBudgets, ownerUser] = await Promise.all([
      Budgets.findAll({
        where: { userId, ...statusWhere },
        include: [includeCategories, includeTags],
      }),
      getSharedBudgetsForUser({
        userId,
        where: statusWhere,
        include: [includeCategories, includeTags],
      }),
      Users.findByPk(userId),
    ]);

    const ownerContext = ownerUser ? await buildOwnerBudgetShareContext({ ownerUser }) : null;

    const ownedWithContext: BudgetWithShareContext[] = ownedBudgets.map((budget) => {
      if (ownerContext) {
        Object.assign(budget, { _shareContext: ownerContext });
      }
      return budget as BudgetWithShareContext;
    });

    return [...ownedWithContext, ...(sharedBudgets as BudgetWithShareContext[])];
  },
);

export const getBudgetById = withTransaction(
  async ({
    userId,
    id,
  }: {
    userId: BudgetModel['userId'];
    id: BudgetModel['id'];
  }): Promise<BudgetWithShareContext | null> => {
    const owned = await Budgets.findOne({
      where: { userId, id },
      include: [includeCategories, includeTags],
    });

    if (owned) {
      const ownerUser = await Users.findByPk(userId);
      if (ownerUser) {
        Object.assign(owned, { _shareContext: await buildOwnerBudgetShareContext({ ownerUser }) });
      }
      return owned as BudgetWithShareContext;
    }

    // Not owned — fall through to the shared lookup. `getSharedBudgetById` runs the
    // central auth check and returns the budget with a recipient share context attached.
    const shared = await getSharedBudgetById({ userId, id, include: [includeCategories, includeTags] });
    return (shared as BudgetWithShareContext | null) ?? null;
  },
);
