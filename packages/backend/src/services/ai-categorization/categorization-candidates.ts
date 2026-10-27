import {
  AI_CATEGORIZATION_MAX_TRANSACTIONS_PER_RUN,
  type SORT_DIRECTIONS,
  TRANSACTION_TRANSFER_NATURE,
  type TRANSACTION_SORT_FIELD,
} from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import Tags from '@models/tags.model';
import TransactionGroups from '@models/transaction-groups.model';
import TransactionSplits from '@models/transaction-splits.model';
import { countTransactions, findTransactions } from '@models/transactions-query';
import Transactions, { buildOrderClause } from '@models/transactions.model';
import { getUserDefaultCategory } from '@models/users.model';
import { type Includeable, Op, type WhereOptions, literal } from 'sequelize';

import { CATEGORIZATION_SCOPE, type CategorizationScope } from './categorization-scope';

export type CandidateWhere = {
  categorizationMeta: null;
  transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer;
  paymentParentId: null;
  categoryId?: string;
};

type CandidateCriteria = { where: WhereOptions; include: Includeable[] };

/**
 * Ownership gate shared by every ai-categorization query: the account must belong to the
 * caller (`Account.userId`). Never filter by `Transactions.userId` instead — on a shared
 * account the row's creator can be a recipient while the account is still the caller's.
 */
export function ownedAccountsInclude({
  userId,
  attributes = [],
}: {
  userId: number;
  attributes?: string[];
}): Includeable {
  return { model: Accounts, where: { userId }, required: true, attributes };
}

/**
 * Single definition of "the AI may decide this row", per scope. The worker selects rows
 * with it and re-checks the very same predicate when writing results back, so a run can
 * never touch a row it did not select.
 *
 * Transfers are excluded on both scopes because the UI neither shows nor lets the user edit
 * a category on them, so an AI guess there is invisible and unfixable.
 *
 * Planned rows are excluded by `planned: 'exclude'` on every query this where is spread into:
 * their category is the user's own entry, and an AI guess would overwrite it before the row
 * ever becomes a real transaction.
 *
 * `null` when a `defaultCategoryOnly` scope meets a user with no default category — nothing
 * can be a candidate then.
 */
export async function buildCandidateWhere({
  userId,
  scope,
}: {
  userId: number;
  scope: CategorizationScope;
}): Promise<CandidateWhere | null> {
  const base = {
    categorizationMeta: null,
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    // A payment's other rows take their category from the main row.
    paymentParentId: null,
  } as const;

  if (scope === CATEGORIZATION_SCOPE.anyCategory) return base;

  const defaultCategoryId = await getUserDefaultCategory({ id: userId });
  if (!defaultCategoryId) return null;

  return { ...base, categoryId: defaultCategoryId };
}

/**
 * The user-facing side: the candidates list, its count and the manual trigger, all on the
 * `defaultCategoryOnly` scope so the rows shown can't drift from the rows a trigger processes.
 *
 * `transactionIds` narrows this predicate instead of replacing it, so caller-supplied ids
 * can only reach rows that were already candidates. An empty list means unscoped.
 */
async function buildCandidateCriteria({
  userId,
  transactionIds,
}: {
  userId: number;
  transactionIds?: string[];
}): Promise<CandidateCriteria | null> {
  const where = await buildCandidateWhere({ userId, scope: CATEGORIZATION_SCOPE.defaultCategoryOnly });
  if (!where) return null;

  return {
    where: transactionIds?.length ? { ...where, id: { [Op.in]: transactionIds } } : where,
    include: [ownedAccountsInclude({ userId })],
  };
}

export async function findCandidateTransactionIds({
  userId,
  transactionIds,
}: {
  userId: number;
  transactionIds?: string[];
}): Promise<string[]> {
  const criteria = await buildCandidateCriteria({ userId, transactionIds });
  if (!criteria) return [];

  const transactions = await findTransactions({
    ...criteria,
    planned: 'exclude',
    access: { accountOwner: userId },
    balanceAdjustments: 'include',
    completeness: { cap: { limit: AI_CATEGORIZATION_MAX_TRANSACTIONS_PER_RUN, onTruncated: 'log' } },
    attributes: ['id'],
    order: [['time', 'DESC']],
  });

  return transactions.map((tx) => tx.id);
}

/** Uncapped, unlike the trigger: the user is told how much work exists, not how much one run takes. */
async function countCandidateTransactions({ userId }: { userId: number }): Promise<number> {
  const criteria = await buildCandidateCriteria({ userId });
  if (!criteria) return 0;

  return countTransactions({
    ...criteria,
    planned: 'exclude',
    access: { accountOwner: userId },
    balanceAdjustments: 'include',
    distinct: true,
    col: 'id',
  });
}

/**
 * Model instances, not raw rows: `raw: true` would bypass the Money getters on `amount`.
 * Splits, tags and groups are hydrated so the shared transactions table renders the same
 * columns here as it does everywhere else.
 *
 * The total is only counted for the first page — later pages of an infinite scroll get `null`
 * rather than paying for a COUNT that cannot have changed meaning for them.
 */
export async function listCandidateTransactions({
  userId,
  limit,
  offset,
  sortBy,
  order,
}: {
  userId: number;
  limit: number;
  offset: number;
  sortBy?: TRANSACTION_SORT_FIELD;
  order: SORT_DIRECTIONS;
}): Promise<{ items: Transactions[]; totalCount: number | null }> {
  const isFirstPage = offset === 0;
  const criteria = await buildCandidateCriteria({ userId });
  if (!criteria) return { items: [], totalCount: isFirstPage ? 0 : null };

  const [items, totalCount] = await Promise.all([
    findTransactions({
      ...criteria,
      planned: 'exclude',
      access: { accountOwner: userId },
      balanceAdjustments: 'include',
      completeness: { page: { offset, limit } },
      include: [
        ...criteria.include,
        {
          model: TransactionSplits,
          as: 'splits',
          include: [{ model: Categories, as: 'category' }],
        },
        {
          model: Tags,
          through: { attributes: [] },
          attributes: ['id', 'name', 'color', 'icon'],
          required: false,
        },
        {
          model: TransactionGroups,
          through: { attributes: [] },
          attributes: [
            'id',
            'name',
            [
              literal(`(
              SELECT COUNT(*)::int
              FROM "TransactionGroupItems"
              WHERE "TransactionGroupItems"."groupId" = "transactionGroups"."id"
            )`),
              'transactionCount',
            ],
          ],
          required: false,
        },
      ],
      order: buildOrderClause({ sortBy, order }),
    }),
    isFirstPage ? countCandidateTransactions({ userId }) : null,
  ]);

  return { items, totalCount };
}
