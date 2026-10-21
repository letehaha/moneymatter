import { moneyToApiDecimalOrNull } from '@common/types/money';
import Subscriptions from '@models/subscriptions.model';
import { clearManualLogoFields, enqueueLogoResolutionAfterCommit } from '@services/brand-logos';
import { withTransaction } from '@services/common/with-transaction';

import { findSubscriptionOrThrow } from './helpers';

/**
 * Clears the manual logo override so the background resolver can re-run and pick
 * a new domain automatically. Sets all four logo fields to null (logoSource null
 * signals the resolver this subscription still needs a resolution pass), then
 * schedules resolution to run once the transaction commits. Enqueuing after
 * commit is required: the worker reads the subscription on a separate
 * connection, so enqueuing inside the open transaction races the commit and the
 * worker can still see the stale `logoSource = 'manual'` value, which its guard
 * skips on – leaving the reset subscription with no logo and no re-resolution.
 */
export const resetSubscriptionLogo = withTransaction(async ({ id, userId }: { id: string; userId: number }) => {
  const subscription = await findSubscriptionOrThrow({ id, userId });
  clearManualLogoFields({ instance: subscription });
  await subscription.save();
  enqueueLogoResolutionAfterCommit({ entity: 'subscription', id });

  // Surface expectedAmount as a decimal so the response matches GET (the column
  // holds raw cents).
  const plain = subscription.toJSON() as Subscriptions;
  return {
    ...plain,
    expectedAmount: moneyToApiDecimalOrNull(plain.expectedAmount),
  };
});
