import { isTwoLegTransfer } from '@bt/shared/types';
import ChatProposals from '@models/chat-proposals.model';
import { findOneTransaction, findTransactions } from '@models/transactions-query';
import { Op } from 'sequelize';

import { ToolInputError } from './placeholders';

/**
 * The arguments of `update_transaction` that the transaction service writes to the other leg of a transfer as
 * well, so one edit of either leg changes both.
 */
const SHARED_TRANSFER_FIELDS = [
  'time',
  'note',
  'externalUrl',
  'externalReference',
  'location',
  'paymentType',
  'categoryId',
] as const;

const sameValue = ({ a, b }: { a: unknown; b: unknown }): boolean => {
  if (typeof a === 'string' && typeof b === 'string') return a === b || new Date(a).getTime() === new Date(b).getTime();
  return JSON.stringify(a) === JSON.stringify(b);
};

/**
 * Whether `args` repeat, for the other leg of a transfer, what a pending card of `pending` already changes on its
 * leg: every shared field `args` set is set to the same value there. Editing one leg writes these fields to both,
 * so the second card would only make the owner approve the same change twice.
 */
export const repeatsSharedFields = ({
  args,
  pending,
}: {
  args: Record<string, unknown>;
  pending: Record<string, unknown>;
}): boolean => {
  const mine = SHARED_TRANSFER_FIELDS.filter((field) => args[field] !== undefined);
  return (
    mine.length > 0 &&
    mine.every((field) => pending[field] !== undefined && sameValue({ a: args[field], b: pending[field] }))
  );
};

/**
 * A transfer is two transactions that move together: an `update_transaction` on one leg updates the shared fields
 * (time, note, category, ...) on the other. A model that proposes the same edit once per leg makes the owner
 * approve two cards for one change, so the second call is refused with the card that already covers it.
 */
export async function assertNoTwinLegUpdate({
  userId,
  threadId,
  args,
}: {
  userId: number;
  threadId: string;
  args: Record<string, unknown>;
}): Promise<void> {
  const id = args.id;
  if (typeof id !== 'string' || !SHARED_TRANSFER_FIELDS.some((field) => args[field] !== undefined)) return;

  const leg = await findOneTransaction({
    planned: 'include',
    access: { accessibleTo: userId },
    balanceAdjustments: 'include',
    where: { id },
    attributes: ['id', 'transferId', 'transferNature'],
  });
  if (!leg?.transferId || !isTwoLegTransfer(leg.transferNature)) return;

  const others = await findTransactions({
    planned: 'include',
    access: { accessibleTo: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    where: { transferId: leg.transferId, id: { [Op.ne]: id } },
    attributes: ['id'],
  });
  if (others.length === 0) return;

  const pending = await ChatProposals.findAll({
    where: { threadId, userId, toolName: 'update_transaction', status: 'pending' },
    attributes: ['id', 'args'],
    raw: true,
  });
  const covering = pending.find(
    (card) =>
      others.some((other) => other.id === (card.args as Record<string, unknown>).id) &&
      repeatsSharedFields({ args, pending: card.args as Record<string, unknown> }),
  );

  if (covering) {
    throw new ToolInputError(
      `Card ${covering.id} already makes this change on the other leg of the transfer, and approving it changes both legs. Do not propose it again for this leg.`,
    );
  }
}
