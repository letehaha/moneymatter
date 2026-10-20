import { SUBSCRIPTION_PERIOD_STATUSES } from '@bt/shared/types';
import { isBankLinkedAccount } from '@models/accounts.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Subscriptions from '@models/subscriptions.model';
import { findOneTransaction } from '@models/transactions-query';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import {
  assertConcreteTargets,
  forUpdate,
  PreviewError,
  serializeRow,
  targetNotFound,
  transactionsAffected,
} from './preview-helpers';
import type { PreviewResolver } from './types';

/**
 * Reverting a paid or skipped period re-opens it. When the app made the payment transaction for the
 * period, the revert deletes that transaction too (unless it is a booked row on a bank-linked
 * account), so the card lists it and counts it.
 */
export const resolveRevertSubscriptionPeriod: PreviewResolver = async ({ userId, args, lock }) => {
  const subscriptionId = args.subscriptionId as string;
  const periodId = args.periodId as string;
  assertConcreteTargets({ value: [subscriptionId, periodId], what: 'subscription period' });

  const subscription = await Subscriptions.findOne({ where: { id: subscriptionId, userId } });
  const period = subscription
    ? await SubscriptionPeriods.findOne({ where: { id: periodId, subscriptionId }, ...forUpdate({ lock }) })
    : null;
  if (!period) throw targetNotFound({ what: 'subscription period' });

  if (
    period.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming ||
    period.status === SUBSCRIPTION_PERIOD_STATUSES.overdue
  ) {
    throw new PreviewError({ messageKey: 'chat.cards.periodAlreadyOpen', message: 'This period is already open' });
  }

  const payment =
    period.transactionId && period.transactionAutoCreated
      ? await findOneTransaction({
          ...forUpdate({ lock }),
          planned: 'include',
          access: { accessibleTo: userId },
          balanceAdjustments: 'include',
          where: { id: period.transactionId },
        })
      : null;
  const deletesPayment =
    payment !== null && (payment.isPlanned || !(await isBankLinkedAccount({ id: payment.accountId })));

  return {
    preview: {
      before: serializeRow({ row: period }),
      ...(deletesPayment ? { affected: transactionsAffected({ rows: [payment], count: 1 }) } : {}),
    },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: [period.updatedAt, deletesPayment ? payment.updatedAt : null] }),
      targetHash: hashTargetIds({ ids: [period.id, ...(deletesPayment ? [payment.id] : [])] }),
      targetCount: deletesPayment ? 2 : 1,
    },
    affectedCount: deletesPayment ? 2 : 1,
    ...(deletesPayment ? { warnings: [{ key: 'chat.warnings.revertDeletesTransaction' }] } : {}),
  };
};
