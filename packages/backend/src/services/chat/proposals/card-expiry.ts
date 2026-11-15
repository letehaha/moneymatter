import ChatProposals from '@models/chat-proposals.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

/** A pending card past its lifetime. The cron expires them in bulk; an action expires the one it touches. */
export const isExpiryDue = ({
  row,
  now = Date.now(),
}: {
  row: Pick<ChatProposals, 'status' | 'expiresAt'>;
  now?: number;
}) => row.status === 'pending' && row.expiresAt.getTime() <= now;

/**
 * Turns the pending cards among `ids` that are past their lifetime into `expired`; returns how many it turned.
 * The due rows are locked first, ids ascending, the order an approval locks its chain in, because an
 * `UPDATE` over several rows locks them in scan order and could deadlock against an approval or a
 * reject that holds one of them and wants another.
 */
export const expireDueCards = withTransaction(async ({ ids }: { ids: string[] }): Promise<number> => {
  if (ids.length === 0) return 0;

  const due = await ChatProposals.findAll({
    where: { id: ids, status: 'pending', expiresAt: { [Op.lte]: new Date() } },
    attributes: ['id'],
    order: [['id', 'ASC']],
    lock: true,
  });
  if (due.length === 0) return 0;

  const [updated] = await ChatProposals.update(
    { status: 'expired', statusReason: 'expired', decidedAt: new Date() },
    { where: { id: due.map((row) => row.id as string), status: 'pending', expiresAt: { [Op.lte]: new Date() } } },
  );

  return updated;
});

/**
 * Expires every pending card past its lifetime, in batches of `batchSize`, and returns how many it
 * turned. A batch is picked by `(status, expiresAt)` and `expireDueCards` re-checks both, so a card an
 * action decided in the meantime is left as the action wrote it.
 */
export async function expireAllDueCards({ batchSize }: { batchSize: number }): Promise<number> {
  let expired = 0;

  for (;;) {
    const due = await ChatProposals.findAll({
      where: { status: 'pending', expiresAt: { [Op.lte]: new Date() } },
      attributes: ['id'],
      order: [['expiresAt', 'ASC']],
      limit: batchSize,
    });
    if (due.length === 0) return expired;

    expired += await expireDueCards({ ids: due.map((row) => row.id as string) });
    if (due.length < batchSize) return expired;
  }
}
