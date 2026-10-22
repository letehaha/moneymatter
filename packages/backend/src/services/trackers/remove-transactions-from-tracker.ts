import { SHARE_PERMISSIONS } from '@bt/shared/types';
import TrackerTransactions from '@models/tracker-transactions.model';
import { withTransaction } from '@services/common/with-transaction';
import Sequelize, { Op } from 'sequelize';

import { authorizeTrackerAccess } from './authorize-tracker-access';
import { rejectUnlinkedTransactions } from './smart-tracking/suggestion-feedback';

interface RemoveTransactionsPayload {
  trackerId: string;
  userId: number;
  transactionIds: string[];
}

export const removeTransactionsFromTracker = withTransaction(async (payload: RemoveTransactionsPayload) => {
  const { trackerId, userId, transactionIds } = payload;

  const { isOwner } = await authorizeTrackerAccess({
    userId,
    trackerId,
    requiredPermission: SHARE_PERMISSIONS.write,
  });

  if (isOwner) {
    // Owner can detach anything attached to their tracker — recipient-attached rows
    // (metadata.addedByUserId set) and owner-attached rows alike.
    const where = { trackerId, transactionId: { [Op.in]: transactionIds } };
    // Recorded even with rules and AI off, so turning either on later does not re-add it.
    const unlinkedIds = (await TrackerTransactions.findAll({ where, attributes: ['transactionId'] })).map(
      (row) => row.transactionId,
    );
    const removedCount = await TrackerTransactions.destroy({ where });
    await rejectUnlinkedTransactions({ userId, trackerId, transactionIds: unlinkedIds });
    return { removedCount };
  }

  // Recipient can only detach rows THEY attached. We match on the JSONB `addedByUserId`
  // field rather than the underlying `transaction.userId` so a recipient who tries to
  // remove an *owner-attached* link to one of their own transactions (e.g. owner pulled
  // recipient's tx into the tracker) still gets blocked.
  //
  // SQL: `metadata->>'addedByUserId' = '<userId>'`. The pattern follows the codebase's
  // `Sequelize.where(Sequelize.literal(...))` convention for JSONB filters (see
  // bank-data-providers/* and cancel-invitation.service.ts).
  //
  // The destroy returns the number of rows actually removed — we surface this so the
  // recipient can tell "your detach matched nothing" (e.g., they passed transactionIds
  // that belong to owner-attached rows) apart from a normal success.
  const removedCount = await TrackerTransactions.destroy({
    where: {
      trackerId,
      transactionId: { [Op.in]: transactionIds },
      [Op.and]: [Sequelize.where(Sequelize.literal(`"metadata"->>'addedByUserId'`), String(userId))],
    },
  });
  return { removedCount };
});
