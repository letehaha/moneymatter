import { SUBSCRIPTION_LINK_STATUS } from '@bt/shared/types';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import { findTransactions } from '@models/transactions-query';
import { Op } from 'sequelize';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import {
  assertConcreteTargets,
  forUpdate,
  keepVisibleRows,
  PreviewError,
  TRANSACTION_SAMPLE_ATTRIBUTES,
  targetNotFound,
  transactionsAffected,
} from './preview-helpers';
import type { PreviewResolver } from './types';

const LINKED_TO_COLUMN = { key: 'linkedTo', label: 'chat.cards.columns.linkedTo', kind: 'text' } as const;

const subscriptionOf = async ({ userId, id, lock }: { userId: number; id: string; lock?: boolean }) => {
  const subscription = await Subscriptions.findOne({ where: { id, userId }, ...forUpdate({ lock }) });
  if (!subscription) throw targetNotFound({ what: 'subscription' });
  return subscription;
};

/** The rows with these ids, wherever the user can see them; a link call names no more than that. */
const transactionsOf = ({ userId, ids, lock }: { userId: number; ids: string[]; lock?: boolean }) =>
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

/**
 * Linking marks transactions as payments of a subscription. The service refuses a transaction that
 * is not the user's, that is of another type than the subscription, or that is linked to any
 * subscription already (this one included). The card lists the transactions with the subscription
 * each is linked to now, and warns about the ones the call would refuse.
 */
export const resolveLinkTransactionsToSubscription: PreviewResolver = async ({ userId, args, lock }) => {
  const subscriptionId = args.subscriptionId as string;
  const requested = [...new Set((args.transactionIds ?? []) as string[])];
  assertConcreteTargets({ value: [subscriptionId, ...requested], what: 'subscription links' });

  const subscription = await subscriptionOf({ userId, id: subscriptionId, lock });
  const rows = await transactionsOf({ userId, ids: requested, lock });
  if (rows.length !== requested.length) throw targetNotFound({ what: 'transaction' });

  const links = await SubscriptionTransactions.findAll({ where: { transactionId: { [Op.in]: requested } } });
  const active = links.filter((link) => link.status === SUBSCRIPTION_LINK_STATUS.active);
  const owners = new Map(
    (
      await Subscriptions.findAll({
        where: { id: { [Op.in]: [...new Set(active.map((link) => link.subscriptionId))] }, userId },
        attributes: ['id', 'name'],
      })
    ).map((owner) => [owner.id, owner.name]),
  );
  const linkedTo = new Map(active.map((link) => [link.transactionId, owners.get(link.subscriptionId) ?? null]));

  const typeMismatches = rows.filter((row) => row.transactionType !== subscription.transactionType).length;
  const warnings = [
    ...(active.length > 0
      ? [{ key: 'chat.warnings.subscriptionAlreadyLinked', params: { count: active.length } }]
      : []),
    ...(typeMismatches > 0
      ? [{ key: 'chat.warnings.subscriptionTypeMismatch', params: { count: typeMismatches } }]
      : []),
  ];

  return {
    preview: {
      affected: transactionsAffected({
        rows: await keepVisibleRows({ userId, rows }),
        count: rows.length,
        extra: {
          columns: [LINKED_TO_COLUMN],
          cells: ({ row }) => ({ linkedTo: linkedTo.get(row.id) ?? null }),
        },
      }),
      counts: { transactionCount: rows.length },
    },
    // A link made or undone after the preview moves no transaction's `updatedAt`, so the links are hashed.
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: [subscription.updatedAt, ...rows.map((row) => row.updatedAt)] }),
      targetHash: hashTargetIds({
        ids: [
          subscription.id,
          ...rows.map((row) => row.id),
          ...links.map((link) => `${link.transactionId}:${link.subscriptionId}:${link.status}`),
        ],
      }),
      targetCount: rows.length,
    },
    affectedCount: rows.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};

/**
 * Unlinking turns the active links of the named transactions to this subscription into unlinked
 * ones; a transaction that is not linked to it stays as it is. The card lists the transactions that
 * are linked and warns about the others.
 */
export const resolveUnlinkTransactionsFromSubscription: PreviewResolver = async ({ userId, args, lock }) => {
  const subscriptionId = args.subscriptionId as string;
  const requested = [...new Set((args.transactionIds ?? []) as string[])];
  assertConcreteTargets({ value: [subscriptionId, ...requested], what: 'subscription links' });

  const subscription = await subscriptionOf({ userId, id: subscriptionId, lock });
  const links = await SubscriptionTransactions.findAll({
    where: { subscriptionId, transactionId: { [Op.in]: requested }, status: SUBSCRIPTION_LINK_STATUS.active },
  });
  if (links.length === 0) {
    throw new PreviewError({
      messageKey: 'chat.cards.nothingToUnlink',
      message: 'None of these transactions is linked to the subscription, so there is nothing to unlink',
    });
  }

  const linkedIds = links.map((link) => link.transactionId);
  const rows = await transactionsOf({ userId, ids: linkedIds, lock });
  const notLinked = requested.length - links.length;

  return {
    preview: {
      affected: transactionsAffected({ rows: await keepVisibleRows({ userId, rows }), count: links.length }),
      counts: { transactionCount: links.length },
    },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: [subscription.updatedAt, ...rows.map((row) => row.updatedAt)] }),
      targetHash: hashTargetIds({ ids: [subscription.id, ...linkedIds] }),
      targetCount: links.length,
    },
    affectedCount: links.length,
    ...(notLinked > 0
      ? { warnings: [{ key: 'chat.warnings.subscriptionNotLinked', params: { count: notLinked } }] }
      : {}),
  };
};
