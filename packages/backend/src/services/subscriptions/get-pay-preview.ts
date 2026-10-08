import { type RecordId, SUBSCRIPTION_LINK_STATUS } from '@bt/shared/types';
import { Money, centsToApiDecimalOrNull } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { ValidationError } from '@js/errors';
import * as Accounts from '@models/accounts.model';
import Payees from '@models/payees.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import { findTransactions } from '@models/transactions-query';
import { withTransaction } from '@services/common/with-transaction';
import { addDays } from 'date-fns';
import { Op } from 'sequelize';

import { calculateNextDueDate } from './calculate-next-due-date';
import { convertSubscriptionAmountToAccountCurrency } from './convert-subscription-amount';
import { findSubscriptionOrThrow } from './helpers';

export interface LinkedPaymentCandidate {
  id: RecordId;
  /** Decimal amount in the transaction's own currency. */
  amount: number;
  currencyCode: string;
  time: Date;
  note: string | null;
  payeeName: string | null;
  accountId: RecordId;
}

export interface SubscriptionPayPreview {
  /** True when the subscription's billed currency differs from its account's currency. */
  isCrossCurrency: boolean;
  /** ISO code the booked expense will be denominated in (the account's currency), or null when no account is linked. */
  accountCurrencyCode: string | null;
  /** ISO code the subscription is billed in. */
  subscriptionCurrencyCode: string | null;
  /** Billed amount in the subscription's own currency (decimal), or null for a variable-amount subscription. */
  expectedAmount: number | null;
  /**
   * Billed amount converted into the account currency at today's rate (decimal),
   * used to pre-fill the pay dialog. Null when there is nothing to convert (no
   * account or no expectedAmount).
   */
  convertedAmount: number | null;
  /**
   * Transactions already linked to the subscription that fall inside the given
   * period and back no period yet, nearest to the due date first. Empty without a periodId.
   */
  linkedPayments: LinkedPaymentCandidate[];
}

const dayStart = ({ dueDate }: { dueDate: string }) => new Date(dueDate + 'T00:00:00Z');

/**
 * Period window: strictly after the previous period's due day and strictly before
 * the next period's due day (computed from the schedule when no next row exists yet).
 * A first period has no previous row, so it reaches back one cycle length instead.
 */
async function findLinkedPaymentsForPeriod({
  userId,
  subscription,
  periodId,
}: {
  userId: number;
  subscription: Subscriptions;
  periodId: RecordId;
}): Promise<LinkedPaymentCandidate[]> {
  const period = await findOrThrowNotFound({
    query: SubscriptionPeriods.findOne({ where: { id: periodId, subscriptionId: subscription.id } }),
    message: 'Subscription period not found.',
  });

  const links = await SubscriptionTransactions.findAll({
    where: { subscriptionId: subscription.id, status: SUBSCRIPTION_LINK_STATUS.active },
    attributes: ['transactionId'],
  });
  if (links.length === 0) return [];

  const linkedIds = links.map((l) => l.transactionId);
  const backing = await SubscriptionPeriods.findAll({
    where: { transactionId: { [Op.in]: linkedIds } },
    attributes: ['transactionId'],
  });
  const backingIds = new Set(backing.map((p) => p.transactionId));
  const candidateIds = linkedIds.filter((id) => !backingIds.has(id));
  if (candidateIds.length === 0) return [];

  const [previous, next] = await Promise.all([
    SubscriptionPeriods.findOne({
      where: { subscriptionId: subscription.id, dueDate: { [Op.lt]: period.dueDate } },
      order: [['dueDate', 'DESC']],
    }),
    SubscriptionPeriods.findOne({
      where: { subscriptionId: subscription.id, dueDate: { [Op.gt]: period.dueDate } },
      order: [['dueDate', 'ASC']],
    }),
  ]);
  const dueStart = dayStart({ dueDate: period.dueDate });
  const nextStart = dayStart({
    dueDate:
      next?.dueDate ??
      calculateNextDueDate({
        currentDueDate: period.dueDate,
        frequency: subscription.frequency,
        anchorDay: subscription.anchorDay ?? dueStart.getUTCDate(),
      }),
  });
  const previousStart = previous
    ? dayStart({ dueDate: previous.dueDate })
    : new Date(2 * dueStart.getTime() - nextStart.getTime());

  const txs = await findTransactions({
    where: {
      id: { [Op.in]: candidateIds },
      time: {
        [Op.lt]: nextStart,
        [Op.gte]: addDays(previousStart, 1),
      },
    },
    include: [{ model: Payees, as: 'payee', attributes: ['name'], required: false }],
    planned: 'exclude',
    access: { creator: userId },
    balanceAdjustments: 'exclude',
    completeness: 'all',
  });

  const dueTime = dueStart.getTime();
  return txs
    .toSorted((a, b) => Math.abs(a.time.getTime() - dueTime) - Math.abs(b.time.getTime() - dueTime))
    .map((tx) => ({
      id: tx.id,
      amount: tx.amount.toNumber(),
      currencyCode: tx.currencyCode,
      time: tx.time,
      note: tx.note || null,
      payeeName: tx.payee?.name ?? null,
      accountId: tx.accountId,
    }));
}

/**
 * Returns what paying a subscription would book, so the pay dialog can pre-fill
 * the amount. Uses `convertSubscriptionAmountToAccountCurrency` — the same
 * function the actual booking uses — guaranteeing the previewed figure matches
 * the booked expense.
 */
export const getSubscriptionPayPreview = withTransaction(
  async ({
    userId,
    subscriptionId,
    periodId,
  }: {
    userId: number;
    subscriptionId: string;
    periodId?: RecordId;
  }): Promise<SubscriptionPayPreview> => {
    const subscription = await findSubscriptionOrThrow({ id: subscriptionId, userId });

    const linkedPayments = periodId ? await findLinkedPaymentsForPeriod({ userId, subscription, periodId }) : [];

    // expectedAmount on the model is raw cents (BIGINT).
    const expectedAmount = centsToApiDecimalOrNull(subscription.expectedAmount);

    if (subscription.accountId == null) {
      return {
        isCrossCurrency: false,
        accountCurrencyCode: null,
        subscriptionCurrencyCode: subscription.expectedCurrencyCode,
        expectedAmount,
        convertedAmount: null,
        linkedPayments,
      };
    }

    const account = await Accounts.getAccountCurrency({ userId, id: subscription.accountId });
    if (account == null) {
      throw new ValidationError({
        message: 'A created transaction requires an account on the subscription.',
      });
    }
    const accountCurrencyCode = account.currency.code;
    const isCrossCurrency =
      subscription.expectedCurrencyCode != null && subscription.expectedCurrencyCode !== accountCurrencyCode;

    // Best-effort: a preview must never surface a 4xx/5xx. When the rate can't be
    // resolved (billed currency not connected yet, or no rate for today), fall back
    // to a null converted amount so the pay dialog still opens and the user can
    // enter the amount manually. The actual booking auto-connects + revalidates.
    let converted: Money | null = null;
    try {
      converted = await convertSubscriptionAmountToAccountCurrency({
        subscription,
        accountCurrencyCode,
        date: new Date(),
      });
    } catch {
      converted = null;
    }

    return {
      isCrossCurrency,
      accountCurrencyCode,
      subscriptionCurrencyCode: subscription.expectedCurrencyCode,
      expectedAmount,
      convertedAmount: centsToApiDecimalOrNull(converted),
      linkedPayments,
    };
  },
);
