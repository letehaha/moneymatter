import { connection } from '@models/connection';
import Subscriptions from '@models/subscriptions.model';
import { updateTransactions } from '@models/transactions-query';
import { DOMAIN_EVENTS, eventBus } from '@services/common/event-bus';
import { withTransaction } from '@services/common/with-transaction';
import { syncLegsOfMains } from '@services/transactions/payment-legs';
import { Op, QueryTypes } from 'sequelize';

import { getSubscriptionTagIds } from './subscription-tags';

interface StampParams {
  subscription: Subscriptions;
  transactionIds: string[];
}

/**
 * Payee is written only where the row has none and payeeLocked is false: an
 * explicit payee, or one the user deliberately cleared, outranks the
 * subscription. Tags are an add-only merge, existing row tags are kept.
 *
 * Planned rows and payment legs are skipped by both writes. Most callers hand over ids they
 * already know are real, but the manual link path passes whatever the user
 * (or the MCP client) selected, so the guard lives here rather than in each
 * caller.
 */
export const stampSubscriptionPayeeAndTags = withTransaction(
  async ({ subscription, transactionIds }: StampParams): Promise<void> => {
    if (transactionIds.length === 0) return;

    if (subscription.payeeId) {
      await updateTransactions({
        values: { payeeId: subscription.payeeId },
        planned: 'exclude',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: { id: { [Op.in]: transactionIds }, payeeId: null, payeeLocked: false, paymentParentId: null },
      });
    }

    const tagIds = await getSubscriptionTagIds({ subscriptionId: subscription.id });
    if (tagIds.length > 0) await stampTags({ subscription, transactionIds, tagIds });

    await syncLegsOfMains({ mainIds: transactionIds });
  },
);

const stampTags = async ({ subscription, transactionIds, tagIds }: StampParams & { tagIds: string[] }) => {
  // RETURNING reports only the pairs that actually inserted, so the reminder
  // event fires only when a row genuinely gained a tag.
  const insertedRows: { transactionId: string }[] = await connection.sequelize.query(
    `
      INSERT INTO "TransactionTags" ("tagId", "transactionId")
      SELECT st."tagId", t."id"
        FROM real_transactions t
        CROSS JOIN "SubscriptionTags" st
       WHERE t."id" IN (:transactionIds)
         AND t."paymentParentId" IS NULL
         AND st."subscriptionId" = :subscriptionId
      ON CONFLICT DO NOTHING
      RETURNING "transactionId"
      `,
    {
      type: QueryTypes.SELECT,
      replacements: { subscriptionId: subscription.id, transactionIds },
    },
  );

  if (insertedRows.length > 0) {
    eventBus.emit(DOMAIN_EVENTS.TRANSACTIONS_TAGGED, { tagIds, userId: subscription.userId });
  }
};
