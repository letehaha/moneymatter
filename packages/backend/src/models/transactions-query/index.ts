import { logger } from '@js/utils/logger';
import Transactions from '@models/transactions.model';
import {
  Attributes,
  CountOptions,
  DestroyOptions,
  FindOptions,
  Includeable,
  IncludeOptions,
  Op,
  UpdateOptions,
  Utils,
  WhereOptions,
} from 'sequelize';

import { accessWhere } from './access-where';
import { AccessPolicy, BalanceAdjustmentsPolicy, CompletenessPolicy, PlannedPolicy, TransfersPolicy } from './policies';
import {
  ComposedWhere,
  balanceAdjustmentsWhere,
  callerFrame,
  capPolicy,
  completenessToPagination,
  composeWhere,
  plannedWhere,
  transfersWhere,
} from './where-builders';

export type { AccessPolicy, CompletenessPolicy, PlannedPolicy } from './policies';

type TxAttributes = Attributes<Transactions>;

interface TxPolicy {
  planned: PlannedPolicy;
  access: AccessPolicy;
  balanceAdjustments: BalanceAdjustmentsPolicy;
  transfers?: TransfersPolicy;
}

const mergeWhere = async ({
  policy,
  where,
}: {
  policy: TxPolicy;
  where?: WhereOptions<TxAttributes>;
}): Promise<ComposedWhere> =>
  composeWhere({
    fragments: [
      plannedWhere({ policy: policy.planned }),
      await accessWhere({ policy: policy.access }),
      balanceAdjustmentsWhere({ policy: policy.balanceAdjustments }),
      transfersWhere({ policy: policy.transfers }),
    ],
    where,
  });

/**
 * Policies that constrain nothing (`'include'`, `'unscoped-internal'`) compose to an empty
 * clause list, which is a legal full-table read but an unbounded write. Writes therefore
 * demand at least one predicate.
 */
const assertScopedWrite = ({ operation, where }: { operation: string; where: ComposedWhere }): void => {
  if (where[Op.and].length) return;

  throw new Error(
    `[transactions-query] ${operation} was called with no effective predicates — refusing to write to every Transactions row. State a narrowing policy or where.`,
  );
};

export interface FindTransactionsOptions extends Omit<FindOptions<TxAttributes>, 'limit' | 'offset'>, TxPolicy {
  completeness: CompletenessPolicy;
}

export const findTransactions = async ({
  planned,
  access,
  balanceAdjustments,
  transfers,
  completeness,
  where,
  ...rest
}: FindTransactionsOptions): Promise<Transactions[]> => {
  const cap = capPolicy({ completeness });
  const probe = cap ? new Error() : null;
  const { limit, offset } = completenessToPagination({ completeness });

  const rows = await Transactions.findAll({
    ...rest,
    where: await mergeWhere({ policy: { planned, access, balanceAdjustments, transfers }, where }),
    limit,
    offset,
  });

  // `info`, not `warn`: warn ships every occurrence to Sentry as its own event.
  if (cap && probe && cap.onTruncated === 'log' && rows.length === cap.limit) {
    logger.info(`[transactions-query] read hit its cap of ${cap.limit} rows, the result is likely truncated`, {
      cap: cap.limit,
      caller: callerFrame({ probe, ignoreFile: __filename }),
      ...cap.context,
    });
  }

  return rows;
};

export const findOneTransaction = async ({
  planned,
  access,
  balanceAdjustments,
  transfers,
  where,
  ...rest
}: Omit<FindTransactionsOptions, 'completeness'>): Promise<Transactions | null> =>
  Transactions.findOne({
    ...rest,
    where: await mergeWhere({ policy: { planned, access, balanceAdjustments, transfers }, where }),
  });

interface CountTransactionsOptions extends Omit<CountOptions<TxAttributes>, 'group'>, TxPolicy {}

export const countTransactions = async ({
  planned,
  access,
  balanceAdjustments,
  transfers,
  where,
  ...rest
}: CountTransactionsOptions): Promise<number> =>
  Transactions.count({
    ...rest,
    where: await mergeWhere({ policy: { planned, access, balanceAdjustments, transfers }, where }),
  });

type TxUpdateValues = {
  [K in keyof TxAttributes]?: TxAttributes[K] | Utils.Fn | Utils.Col | Utils.Literal;
};

interface UpdateTransactionsOptions extends UpdateOptions<TxAttributes>, TxPolicy {
  values: TxUpdateValues;
}

export const updateTransactions = async ({
  planned,
  access,
  balanceAdjustments,
  transfers,
  where,
  values,
  ...rest
}: UpdateTransactionsOptions): Promise<[affectedCount: number, affectedRows?: Transactions[]]> => {
  const composed = await mergeWhere({ policy: { planned, access, balanceAdjustments, transfers }, where });

  assertScopedWrite({ operation: 'updateTransactions', where: composed });

  return Transactions.update(values, { ...rest, where: composed });
};

// `truncate` (and its `cascade`/`restartIdentity` companions) stays off this interface: it empties
// the table and ignores `where`, so no policy could constrain it.
interface DestroyTransactionsOptions
  extends Omit<DestroyOptions<TxAttributes>, 'cascade' | 'force' | 'restartIdentity' | 'truncate' | 'where'>, TxPolicy {
  where: WhereOptions<TxAttributes>;
}

export const destroyTransactions = async ({
  planned,
  access,
  balanceAdjustments,
  transfers,
  where,
  ...rest
}: DestroyTransactionsOptions): Promise<number> => {
  const composed = await mergeWhere({ policy: { planned, access, balanceAdjustments, transfers }, where });

  assertScopedWrite({ operation: 'destroyTransactions', where: composed });

  return Transactions.destroy({ ...rest, where: composed, force: true });
};

/**
 * `required` is mandatory so the join type is always the caller's decision: Sequelize
 * otherwise derives INNER vs LEFT from whether a where ended up attached, which flips
 * as soon as a policy resolves to an empty clause.
 */
type TransactionsIncludeOptions = IncludeOptions & { planned: PlannedPolicy; required: boolean };

export const transactionsInclude = ({ planned, required, where, ...rest }: TransactionsIncludeOptions): Includeable => {
  const composed = composeWhere({ fragments: [plannedWhere({ policy: planned })], where });

  return { model: Transactions, ...rest, required, ...(composed[Op.and].length ? { where: composed } : {}) };
};
