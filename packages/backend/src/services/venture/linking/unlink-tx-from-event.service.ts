import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { ValidationError } from '@js/errors';
import * as Transactions from '@models/transactions.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import { OriginalTransactionStateSnapshot } from '@services/common/transaction-linking';
import { withTransaction } from '@services/common/with-transaction';

interface UnlinkTxFromEventParams {
  userId: number;
  eventId?: string;
  linkId: string;
}

/**
 * Removes one link row, restoring the original transaction state captured
 * at link time. Tx amount itself is not touched (linking didn't change it).
 *
 * The event's `cashFlowMode` and `lpNetAmount` are not modified here — the
 * caller (event service) decides whether the remaining sum still matches.
 *
 * When `eventId` is provided, validates that the link belongs to that event
 * so that a mismatched URL path (DELETE /events/X/links/Y where Y belongs
 * to a different event) is rejected rather than silently accepted.
 */
const unlinkTxFromEventImpl = async ({ userId, eventId, linkId }: UnlinkTxFromEventParams) => {
  const link = await findOrThrowNotFound({
    query: VentureEventLinks.findOne({
      where: { id: linkId },
      include: [{ association: 'event', where: { userId }, required: true }],
    }),
    message: 'Venture event link not found',
  });

  if (eventId !== undefined && link.ventureEventId !== eventId) {
    throw new ValidationError({ message: 'Link does not belong to the specified event' });
  }

  const snapshot = (link.metaData?.originalTransactionState ?? null) as OriginalTransactionStateSnapshot | null;
  if (!snapshot) {
    throw new ValidationError({
      message: 'Link row is missing original transaction state snapshot; cannot safely unlink',
    });
  }

  await Transactions.updateTransactionById({
    id: link.transactionId,
    userId,
    transferNature: snapshot.transferNature ?? TRANSACTION_TRANSFER_NATURE.not_transfer,
    refCurrencyCode: snapshot.refCurrencyCode,
    refAmount: snapshot.refAmount === null ? null : Money.fromDecimal(snapshot.refAmount),
  });

  await link.destroy();

  return { success: true };
};

export const unlinkTxFromEvent = withTransaction(unlinkTxFromEventImpl);
