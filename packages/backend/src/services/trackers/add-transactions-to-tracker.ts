import { SHARE_PERMISSIONS } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import TrackerTransactions, { TrackerTransactionMetadata } from '@models/tracker-transactions.model';
import { findTransactions } from '@models/transactions-query';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { authorizeTrackerAccess } from './authorize-tracker-access';
import { acceptLinkedTransactions } from './smart-tracking/suggestion-feedback';

interface AddTransactionsPayload {
  trackerId: string;
  userId: number;
  transactionIds: string[];
}

export const addTransactionsToTracker = withTransaction(async (payload: AddTransactionsPayload) => {
  const { trackerId, userId, transactionIds } = payload;

  // `write` permission lets recipients attach their own transactions; manage/owner pass
  // through unchanged. Recipients without `write` (i.e. `read`) get a 404 here.
  const { ownerUserId, isOwner } = await authorizeTrackerAccess({
    userId,
    trackerId,
    requiredPermission: SHARE_PERMISSIONS.write,
  });

  // Recipients can only attach THEIR OWN transactions to a shared tracker. Owners can attach
  // anything they own, whether or not it matches the tracker's rules.
  const txOwnerUserId = isOwner ? ownerUserId : userId;
  // Plans are attachable on purpose: owners track their own planned spend in trackers;
  // recipients never see them via stats scoping.
  const transactions = await findTransactions({
    planned: 'include',
    access: { creator: txOwnerUserId },
    balanceAdjustments: 'include',
    completeness: 'all',
    where: { id: { [Op.in]: transactionIds } },
    attributes: ['id'],
  });

  if (transactions.length !== transactionIds.length) {
    throw new ValidationError({ message: t({ key: 'budgets.someTransactionIdsInvalid' }) });
  }

  // Stamp `addedByUserId` on recipient-attached rows so the share-revocation sweep and
  // the detach-permission check can identify rows the recipient owns. Owner-attached
  // rows leave `metadata` null — interpreted as "owner-attached" downstream.
  const metadata: TrackerTransactionMetadata | null = isOwner ? null : { addedByUserId: userId };
  const trackerTransactions = transactionIds.map((transactionId) => ({
    trackerId,
    transactionId,
    metadata,
  }));

  await TrackerTransactions.bulkCreate(trackerTransactions);
  await acceptLinkedTransactions({ trackerId, transactionIds });

  return {
    message: t({ key: 'budgets.transactionsAddedSuccessfully' }),
  };
});
