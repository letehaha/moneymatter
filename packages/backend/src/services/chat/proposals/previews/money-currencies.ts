import { RESOURCE_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import Subscriptions from '@models/subscriptions.model';
import { findOneTransaction } from '@models/transactions-query';
import { getBaseCurrency } from '@models/users-currencies.model';
import { canUserAccessResource } from '@services/sharing/auth/can-user-access-resource.service';

import { findProposalRefs } from '../placeholders';

/**
 * The currency of a money argument whose card does not say it, by argument name, read from the user's data. It
 * travels in `preview.before` under `moneyCurrencies`, where the card reads it, and is never the model's.
 */
export type MoneyCurrencies = Record<string, string>;

/** The currency of an account of the user; `null` for any other account. */
export const accountCurrencyOf = async ({
  userId,
  accountId,
}: {
  userId: number;
  accountId: string;
}): Promise<string | null> =>
  (await Accounts.findOne({ where: { id: accountId, userId }, attributes: ['currencyCode'] }))?.currencyCode ?? null;

/** A tracker's limits are in its owner's base currency, which a recipient's own base can differ from. */
export const trackerLimitCurrencies = async ({
  ownerUserId,
}: {
  ownerUserId: number;
}): Promise<MoneyCurrencies | null> => {
  const base = await getBaseCurrency({ userId: ownerUserId });
  return base ? { limitAmount: base.currencyCode } : null;
};

/** An id of a record that exists: a `$proposal:` ref names one that has not been made, so there is nothing to read. */
const existingId = ({ value }: { value: unknown }): string | null =>
  typeof value === 'string' && findProposalRefs({ value }).length === 0 ? value : null;

type ArgsOnlyResolver = (params: { userId: number; args: Record<string, unknown> }) => Promise<MoneyCurrencies | null>;

/** Tools with no preview resolver that hold an amount their arguments can leave without a currency. */
const ARGS_ONLY_RESOLVERS: Readonly<Record<string, ArgsOnlyResolver>> = {
  // Without an account of its own, the payment books on the account of the subscription.
  pay_subscription_period: async ({ userId, args }) => {
    const subscriptionId = existingId({ value: args.subscriptionId });
    if (typeof args.amount !== 'number' || args.accountId != null || !subscriptionId) return null;

    const subscription = await Subscriptions.findOne({
      where: { id: subscriptionId, userId },
      attributes: ['accountId'],
    });
    const currency = subscription?.accountId
      ? await accountCurrencyOf({ userId, accountId: subscription.accountId })
      : null;
    return currency ? { amount: currency } : null;
  },

  // A share of a refund is in the currency of the refund transaction.
  link_refund: async ({ userId, args }) => {
    const id = existingId({ value: args.refundTxId });
    if (typeof args.amount !== 'number' || !id) return null;

    const row = await findOneTransaction({
      planned: 'include',
      access: { accessibleTo: userId },
      balanceAdjustments: 'include',
      attributes: ['currencyCode'],
      where: { id },
    });
    return row ? { amount: row.currencyCode } : null;
  },

  create_tracker_line: async ({ userId, args }) => {
    const trackerId = existingId({ value: args.trackerId });
    if (typeof args.limitAmount !== 'number' || !trackerId) return null;

    const access = await canUserAccessResource({
      userId,
      resourceType: RESOURCE_TYPES.tracker,
      resourceId: trackerId,
      requiredPermission: SHARE_PERMISSIONS.read,
    });
    return access.granted ? trackerLimitCurrencies({ ownerUserId: access.ownerUserId }) : null;
  },
};

/** What a card with no preview resolver reads to say which currency its amounts are in; `null` when it has nothing. */
export const resolveArgsOnlyMoneyCurrencies = ({
  userId,
  toolName,
  args,
}: {
  userId: number;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<MoneyCurrencies | null> => ARGS_ONLY_RESOLVERS[toolName]?.({ userId, args }) ?? Promise.resolve(null);
