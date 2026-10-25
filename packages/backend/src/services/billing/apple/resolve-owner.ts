import { BILLING_PROVIDERS } from '@bt/shared/types';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import Users from '@models/users.model';

interface AppleOwner {
  userId: number;
  token: string;
}

/**
 * The token on Apple's latest transaction names its buyer and outranks the mirrored row: a
 * resubscribe from another account on the same Apple ID keeps the `originalTransactionId`, so
 * the row moves to that buyer. A token no account holds belongs to a deleted account.
 */
export async function resolveAppleOwner({
  originalTransactionId,
  appAccountToken,
}: {
  originalTransactionId: string;
  appAccountToken: string | undefined;
}): Promise<{ owner: AppleOwner | 'deleted' | null; mirroredForUserId: number | null }> {
  // Swift's `UUID.uuidString` is uppercase; Postgres returns UUIDs lowercase.
  const token = appAccountToken?.toLowerCase();
  const [buyer, row] = await Promise.all([
    token ? Users.findOne({ where: { appStoreAccountToken: token }, attributes: ['id'] }) : null,
    BillingSubscriptions.findOne({
      where: { provider: BILLING_PROVIDERS.apple, externalSubscriptionId: originalTransactionId },
      attributes: ['id', 'userId', 'externalCustomerId'],
    }),
  ]);
  const mirroredForUserId = row?.userId ?? null;

  if (buyer) {
    if (row && row.userId !== buyer.id) await row.update({ userId: buyer.id });
    return { owner: { userId: buyer.id, token: token! }, mirroredForUserId };
  }
  if (row) return { owner: { userId: row.userId, token: row.externalCustomerId }, mirroredForUserId };
  return { owner: token ? 'deleted' : null, mirroredForUserId };
}
