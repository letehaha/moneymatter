import { Money } from '@common/types/money';
import Subscriptions from '@models/subscriptions.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';

/**
 * Converts the subscription's billed amount (`expectedAmount`, in
 * `expectedCurrencyCode`) into the currency of the account it is paid from,
 * valued at `date`.
 *
 * A subscription can be billed in one currency (e.g. a USD plan) while paid
 * from an account in another (e.g. a UAH card). The booked expense must be in
 * the account's currency, so the billed amount is converted at payment time.
 * The pay-preview and the actual booking call this same function — what the
 * user confirms is exactly what gets booked, never different.
 *
 * Returns the unchanged `expectedAmount` (as Money) when the subscription
 * shares the account's currency, and `null` when there is no `expectedAmount`
 * to convert (a variable-amount subscription such as a bill type).
 */
export async function convertSubscriptionAmountToAccountCurrency({
  subscription,
  accountCurrencyCode,
  date,
}: {
  subscription: Subscriptions;
  accountCurrencyCode: string;
  date: Date;
}): Promise<Money | null> {
  const expected = subscription.expectedAmount;
  if (expected == null) return null;

  if (!subscription.expectedCurrencyCode || subscription.expectedCurrencyCode === accountCurrencyCode) {
    return expected;
  }

  return calculateRefAmount({
    userId: subscription.userId,
    definitionOwnerUserId: subscription.userId,
    amount: expected,
    baseCode: subscription.expectedCurrencyCode,
    quoteCode: accountCurrencyCode,
    date,
  });
}
