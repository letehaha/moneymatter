import type { ChatCardAffected, ChatTableColumn, ChatTableRow, RecordId } from '@bt/shared/types';
import { NotFoundError } from '@js/errors';
import type BudgetPlans from '@models/budget-plans.model';
import { countTransactions, findTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import { findPlan } from '@services/budget-plans/find-plan';
import { getAccessibleAccountIdsForUser } from '@services/sharing/auth/get-accessible-account-ids.service';
import { Op } from 'sequelize';

import { findProposalRefs } from '../placeholders';

/** Rows a card lists as samples. */
export const SAMPLE_ROW_LIMIT = 10;

/**
 * A reason a preview cannot be computed that the card shows as such: the key is translated by the
 * frontend and the message is the fallback. The card is stored without a preview, so it cannot be
 * approved.
 */
export class PreviewError extends Error {
  readonly messageKey: string;

  constructor({ messageKey, message }: { messageKey: string; message: string }) {
    super(message);
    this.messageKey = messageKey;
  }
}

export const targetNotFound = ({ what }: { what: string }) =>
  new PreviewError({ messageKey: 'chat.cards.targetNotFound', message: `The ${what} was not found` });

/**
 * A target that is a `$proposal:` ref names a record that does not exist yet, so there is nothing to
 * read. The model proposes the final values in the create call instead.
 */
export function assertConcreteTargets({ value, what }: { value: unknown; what: string }): void {
  if (findProposalRefs({ value }).length === 0) return;

  throw new PreviewError({
    messageKey: 'chat.cards.targetIsProposal',
    message: `The ${what} is a pending proposal, not an existing record. Put the final values in the proposal that creates it.`,
  });
}

/** The find option that holds the rows read `FOR UPDATE` when `lock` is set; nothing otherwise. */
export const forUpdate = ({ lock }: { lock?: boolean }): { lock?: true } => (lock ? { lock: true } : {});

/**
 * The user's budget plan, or `null` when there is none. Under `lock` it takes the lock the budget
 * services take on the plan (`findPlan`), and it has to be the first row a preview holds: every
 * plan write locks the plan before the line, group or assignment it touches.
 */
export async function findPlanOrNull({
  planId,
  userId,
  lock,
}: {
  planId: string;
  userId: number;
  lock?: boolean;
}): Promise<BudgetPlans | null> {
  try {
    return await findPlan({ planId: planId as RecordId, userId, lock });
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

/**
 * Transactions the user wrote on a payee, plans and balance adjustments included: the rows a merge
 * moves and a tag application stamps, which both services find by creator.
 */
export const countPayeeTransactions = ({ userId, payeeId }: { userId: number; payeeId: string }): Promise<number> =>
  countTransactions({
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    where: { payeeId },
  });

/**
 * Every transaction on a payee the user can access, whoever wrote it: deleting the payee unlinks all
 * of them through the foreign key, not only the user's own.
 */
export const countPayeeReferences = ({ userId, payeeId }: { userId: number; payeeId: string }): Promise<number> =>
  countTransactions({
    planned: 'include',
    access: { accessibleTo: userId },
    balanceAdjustments: 'include',
    where: { payeeId },
  });

/** Whether a transaction is on an account the user owns or has a share of: the access a read follows. */
export async function canSeeTransaction({ userId, id }: { userId: number; id: string }): Promise<boolean> {
  const count = await countTransactions({
    planned: 'include',
    access: { accessibleTo: userId },
    balanceAdjustments: 'include',
    where: { id },
  });
  return count > 0;
}

/** Columns the sample rows of a plain JSON round trip leave out: large, internal, and never on a card. */
const OMITTED_COLUMNS = new Set(['externalData', 'creatorSnapshot', 'categorizationMeta', 'metaData']);

/** A row as JSON (money as decimals, dates as ISO text) without the internal columns. */
export function serializeRow({ row }: { row: unknown }): Record<string, unknown> {
  const plain = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
  for (const key of OMITTED_COLUMNS) delete plain[key];
  return plain;
}

/** Column labels are i18n keys the frontend translates; the cells are values and entity refs. */
const TRANSACTION_COLUMNS: ChatTableColumn[] = [
  { key: 'time', label: 'chat.cards.columns.time', kind: 'date' },
  { key: 'account', label: 'chat.cards.columns.account', kind: 'entity' },
  { key: 'type', label: 'chat.cards.columns.type', kind: 'text' },
  { key: 'amount', label: 'chat.cards.columns.amount', kind: 'number' },
  { key: 'currency', label: 'chat.cards.columns.currency', kind: 'text' },
  { key: 'category', label: 'chat.cards.columns.category', kind: 'entity' },
  { key: 'payee', label: 'chat.cards.columns.payee', kind: 'entity' },
  { key: 'note', label: 'chat.cards.columns.note', kind: 'text' },
];

/** The columns a sample row and a snapshot need; the full row is never read for a list. */
export const TRANSACTION_SAMPLE_ATTRIBUTES: Array<keyof Transactions> = [
  'id',
  'time',
  'accountId',
  'transactionType',
  'amount',
  'currencyCode',
  'categoryId',
  'payeeId',
  'note',
  'transferId',
  'transferNature',
  'isPlanned',
  'refundLinked',
  'updatedAt',
];

/**
 * The transactions the user wrote with these ids, newest first. The bulk update and delete and the
 * reconciliation services find their rows by creator, so this is the set they touch; show it only
 * through `keepVisibleRows`, since the user may have lost the account a row is on.
 */
export const loadUserTransactions = ({
  userId,
  ids,
  lock,
}: {
  userId: number;
  ids: string[];
  lock?: boolean;
}): Promise<Transactions[]> =>
  findTransactions({
    ...forUpdate({ lock }),
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    attributes: TRANSACTION_SAMPLE_ATTRIBUTES,
    where: { id: ids },
    order: [
      ['time', 'DESC'],
      ['id', 'DESC'],
    ],
  });

type TransactionSampleSource = Pick<
  Transactions,
  'time' | 'accountId' | 'transactionType' | 'amount' | 'currencyCode' | 'categoryId' | 'payeeId' | 'note'
>;

const toTransactionRow = ({ row }: { row: TransactionSampleSource }): ChatTableRow => ({
  time: new Date(row.time).toISOString(),
  account: { kind: 'account', id: row.accountId },
  type: row.transactionType,
  amount: row.amount.toNumber(),
  currency: row.currencyCode,
  category: row.categoryId ? { kind: 'category', id: row.categoryId } : null,
  payee: row.payeeId ? { kind: 'payee', id: row.payeeId } : null,
  note: row.note ? row.note : null,
});

/** Columns a resolver adds to the transaction table, with the cells of each row. */
interface ExtraTransactionColumns<Row> {
  columns: ChatTableColumn[];
  cells: (params: { row: Row }) => ChatTableRow;
}

/** The affected block of a card that lists transactions: the full count and the first rows. */
export function transactionsAffected<Row extends TransactionSampleSource>({
  rows,
  count,
  extra,
}: {
  rows: Row[];
  count: number;
  extra?: ExtraTransactionColumns<Row>;
}): ChatCardAffected {
  return {
    count,
    columns: [...TRANSACTION_COLUMNS, ...(extra?.columns ?? [])],
    rows: rows.slice(0, SAMPLE_ROW_LIMIT).map((row) => ({ ...toTransactionRow({ row }), ...extra?.cells({ row }) })),
    truncated: count > SAMPLE_ROW_LIMIT,
  };
}

/** The rows on accounts the user can see now; the others still count, but their details are not shown. */
export async function keepVisibleRows<Row extends Pick<Transactions, 'accountId'>>({
  userId,
  rows,
}: {
  userId: number;
  rows: Row[];
}): Promise<Row[]> {
  if (rows.length === 0) return [];

  const accountIds = new Set(await getAccessibleAccountIdsForUser({ userId }));
  return rows.filter((row) => accountIds.has(row.accountId));
}

/**
 * The other leg of each transfer among `legs`, outside `rows`, which a delete removes with its leg
 * (or an import undo removes or unlinks). The services find the twins by `transferId` alone, because
 * a transfer across a shared account has one leg per user, so this lookup is not limited to the
 * creator or to the accounts the user can see.
 */
export async function loadTransferTwins({
  rows,
  legs = rows,
  lock,
}: {
  rows: Transactions[];
  legs?: Transactions[];
  lock?: boolean;
}): Promise<Transactions[]> {
  const transferIds = [...new Set(legs.flatMap((row) => (row.transferId ? [row.transferId] : [])))];
  if (transferIds.length === 0) return [];

  return findTransactions({
    ...forUpdate({ lock }),
    planned: 'include',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    completeness: 'all',
    attributes: TRANSACTION_SAMPLE_ATTRIBUTES,
    where: { transferId: transferIds, id: { [Op.notIn]: rows.map((row) => row.id) } },
  });
}

/** Each target followed by its twin, so the sample shows a transfer's two legs together. */
export function withTwinsAfterTheirLeg({
  rows,
  twins,
}: {
  rows: Transactions[];
  twins: Transactions[];
}): Transactions[] {
  const twinsByTransfer = Map.groupBy(twins, (twin) => twin.transferId);
  return rows.flatMap((row) => [row, ...(row.transferId ? (twinsByTransfer.get(row.transferId) ?? []) : [])]);
}
