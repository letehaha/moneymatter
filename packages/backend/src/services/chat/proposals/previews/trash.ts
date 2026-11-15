import { type ChatCardWarning, TRANSACTION_TRASH_RETENTION_DAYS } from '@bt/shared/types';
import type Transactions from '@models/transactions.model';
import { findNonTrashableIds } from '@services/transactions/trash/find-non-trashable-ids';

import { PreviewError } from './preview-helpers';

type NonTrashableReason = Awaited<ReturnType<typeof findNonTrashableIds>> extends Map<string, infer R> ? R : never;

const NOT_TRASHABLE_MESSAGES: Record<NonTrashableReason, string> = {
  payment: 'The transaction belongs to a payment, so it cannot go to Trash until it leaves the payment',
  portfolio: 'The transaction is linked to a portfolio, so it cannot go to Trash until it is unlinked',
  venture: 'The transaction is linked to a venture event, so it cannot go to Trash until it is unlinked',
};

const notTrashable = ({ reason }: { reason: NonTrashableReason }) =>
  new PreviewError({ messageKey: `chat.cards.notTrashable.${reason}`, message: NOT_TRASHABLE_MESSAGES[reason] });

/** A delete of transactions moves them to Trash, where the user can restore them for the retention period. */
export const movesToTrashWarning = ({ count }: { count: number }): ChatCardWarning => ({
  key: 'chat.warnings.movesToTrash',
  params: { count, days: TRANSACTION_TRASH_RETENTION_DAYS },
});

/**
 * A single delete moves the row and its transfer twin to Trash together, and the service refuses the
 * whole call when one of them belongs to a payment, a portfolio or a venture event. The card is
 * refused the same way, with the reason.
 */
export async function assertLegsTrashable({ ids }: { ids: string[] }): Promise<void> {
  const [reason] = (await findNonTrashableIds({ transactionIds: ids })).values();
  if (reason) throw notTrashable({ reason });
}

/**
 * The rows of a bulk delete that go to Trash. The service skips a selected row that belongs to a
 * payment, a portfolio or a venture event, and lists it as skipped; those rows are left out here and
 * counted. A kept row whose other leg cannot go fails the whole call, so the card is refused, and so
 * is a card none of whose rows can go.
 */
export async function splitTrashableRows({
  rows,
  twins,
}: {
  rows: Transactions[];
  twins: Transactions[];
}): Promise<{ kept: Transactions[]; keptTwins: Transactions[]; skippedIds: string[] }> {
  const reasons = await findNonTrashableIds({ transactionIds: [...rows, ...twins].map((row) => row.id) });
  if (reasons.size === 0) return { kept: rows, keptTwins: twins, skippedIds: [] };

  const kept = rows.filter((row) => !reasons.has(row.id));
  const skippedIds = rows.filter((row) => reasons.has(row.id)).map((row) => row.id);
  if (kept.length === 0) throw notTrashable({ reason: reasons.get(rows[0]!.id)! });

  const blocked = new Map(
    [...rows, ...twins].flatMap((row) =>
      reasons.has(row.id) && row.transferId ? [[row.transferId, reasons.get(row.id)!] as const] : [],
    ),
  );
  const blocking = kept.find((row) => row.transferId && blocked.has(row.transferId));
  if (blocking) throw notTrashable({ reason: blocked.get(blocking.transferId!)! });

  const keptTransfers = new Set(kept.flatMap((row) => (row.transferId ? [row.transferId] : [])));
  return {
    kept,
    keptTwins: twins.filter((twin) => twin.transferId && keptTransfers.has(twin.transferId)),
    skippedIds,
  };
}
