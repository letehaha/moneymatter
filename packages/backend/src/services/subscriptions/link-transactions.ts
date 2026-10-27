import { CATEGORIZATION_SOURCE, SUBSCRIPTION_LINK_STATUS, SUBSCRIPTION_MATCH_SOURCE } from '@bt/shared/types';
import type { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError, ValidationError } from '@js/errors';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { findSubscriptionOrThrow } from './helpers';
import { stampSubscriptionPayeeAndTags } from './stamp-payee-and-tags';

interface LinkTransactionsParams {
  subscriptionId: RecordId;
  transactionIds: RecordId[];
  userId: number;
  matchSource: SUBSCRIPTION_MATCH_SOURCE;
}

export const linkTransactionsToSubscription = withTransaction(
  async ({ subscriptionId, transactionIds, userId, matchSource }: LinkTransactionsParams) => {
    const subscription = await findSubscriptionOrThrow({ id: subscriptionId, userId });

    // Validate all transactions belong to user. Plans are linkable — a subscription
    // may well be tracked ahead of the charge — so they stay in the lookup.
    const txs = await findTransactions({
      where: { id: { [Op.in]: transactionIds } },
      planned: 'include',
      access: { creator: userId },
      balanceAdjustments: 'include',
      completeness: 'all',
    });

    if (txs.length !== transactionIds.length) {
      throw new NotFoundError({ message: t({ key: 'subscriptions.transactionsNotFoundOrNotBelongToUser' }) });
    }

    // A leg copies its main row, so the main is the one to link.
    if (txs.some((tx) => tx.paymentParentId)) {
      throw new ValidationError({ message: t({ key: 'transactions.inPaymentNotAllowed' }) });
    }

    const typeMismatches = txs.filter((tx) => tx.transactionType !== subscription.transactionType);
    if (typeMismatches.length > 0) {
      throw new ValidationError({
        message: t({ key: 'subscriptions.cannotLinkDifferentTransactionType' }),
      });
    }

    // Check for existing links (active or previously unlinked)
    const existingLinks = await SubscriptionTransactions.findAll({
      where: { transactionId: { [Op.in]: transactionIds } },
    });

    // Separate into re-linkable (unlinked from THIS subscription) vs truly conflicting
    const reLinkable: SubscriptionTransactions[] = [];
    const conflicting: SubscriptionTransactions[] = [];

    for (const link of existingLinks) {
      if (link.subscriptionId === subscriptionId && link.status === SUBSCRIPTION_LINK_STATUS.unlinked) {
        reLinkable.push(link);
      } else if (link.status === SUBSCRIPTION_LINK_STATUS.active) {
        conflicting.push(link);
      }
    }

    if (conflicting.length > 0) {
      const linkedIds = conflicting.map((l) => l.transactionId);
      throw new ConflictError({
        message: `Transactions already linked to a subscription: ${linkedIds.join(', ')}`,
        details: { transactionIds: linkedIds },
      });
    }

    // Re-link previously unlinked transactions
    const reLinkIds = new Set(reLinkable.map((l) => l.transactionId));
    if (reLinkIds.size > 0) {
      await SubscriptionTransactions.update(
        { status: SUBSCRIPTION_LINK_STATUS.active, matchSource, matchedAt: new Date() },
        {
          where: {
            subscriptionId,
            transactionId: { [Op.in]: [...reLinkIds] },
          },
        },
      );
    }

    // Create new links for transactions that don't have existing rows
    const newTransactionIds = transactionIds.filter((id) => !reLinkIds.has(id));
    if (newTransactionIds.length > 0) {
      const links = newTransactionIds.map((transactionId) => ({
        subscriptionId,
        transactionId,
        matchSource,
      }));

      await SubscriptionTransactions.bulkCreate(links);
    }

    // If rule-matched and subscription has a categoryId, apply category to transactions.
    // On a planned row the user picked the category on purpose, so the rule only records
    // the link — same policy the automatic matcher applies (matching-engine.ts).
    if (matchSource === SUBSCRIPTION_MATCH_SOURCE.rule && subscription.categoryId) {
      await updateTransactions({
        values: {
          categoryId: subscription.categoryId,
          categorizationMeta: {
            source: CATEGORIZATION_SOURCE.subscriptionRule,
            subscriptionId,
            categorizedAt: new Date().toISOString(),
          },
        },
        where: { id: { [Op.in]: transactionIds } },
        planned: 'exclude',
        access: { creator: userId },
        balanceAdjustments: 'include',
      });
    }

    await stampSubscriptionPayeeAndTags({ subscription, transactionIds });

    return { linked: transactionIds.length };
  },
);
