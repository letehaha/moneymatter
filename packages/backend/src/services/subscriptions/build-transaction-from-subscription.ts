import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { UnexpectedError, ValidationError } from '@js/errors';
import * as Accounts from '@models/accounts.model';
import Subscriptions from '@models/subscriptions.model';
import * as Users from '@models/users.model';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';
import type { CreateTransactionParams } from '@services/transactions/types';

import { convertSubscriptionAmountToAccountCurrency } from './convert-subscription-amount';
import { getSubscriptionTagIds } from './subscription-tags';

/**
 * Translates a subscription into the params for `createTransaction`.
 *
 * The booked direction (expense or income) comes from the subscription's own
 * `transactionType`, against its stored account. `transferNature` is fixed to
 * `not_transfer`; `accountType` is omitted so `createTransaction` resolves it
 * and rejects a manual write onto a bank-connected account.
 *
 * `categoryId` falls back to the user's `defaultCategoryId` when the
 * subscription has none. `createTransaction` accepts a null/undefined category,
 * so when neither the subscription nor the user provides one the transaction is
 * created uncategorized rather than rejected.
 *
 * The booked transaction is always denominated in the account's currency. When
 * the subscription is billed in a different currency (e.g. a USD plan paid from
 * a UAH account), the amount is resolved as follows:
 *   - an explicit `amount` override is taken verbatim (already in the account's
 *     currency, confirmed by the user in the pay dialog);
 *   - otherwise the subscription's `expectedAmount` is
 *     converted into the account currency via
 *     `convertSubscriptionAmountToAccountCurrency`.
 *
 * Validation (account presence, amount availability) lives here so create-mode
 * fails before any row is written.
 */
export async function buildTransactionFromSubscription({
  subscription,
  amount,
  time,
}: {
  subscription: Subscriptions;
  /** Decimal override for the booked amount, expressed in the ACCOUNT's currency. */
  amount?: number;
  /** Actual payment date override. Falls back to now. */
  time?: Date;
}): Promise<CreateTransactionParams> {
  if (subscription.accountId == null) {
    throw new ValidationError({
      message: 'A created transaction requires an account on the subscription.',
    });
  }

  const effectiveTime = time ?? new Date();

  let amountMoney: Money;
  if (amount != null) {
    amountMoney = Money.fromDecimal(amount);
  } else {
    const account = await Accounts.getAccountCurrency({ userId: subscription.userId, id: subscription.accountId });
    if (account == null) {
      throw new ValidationError({
        message: 'A created transaction requires an account on the subscription.',
      });
    }

    // The billed currency may be one the user hasn't connected (the subscription
    // form offers every currency). Connect it before the rate lookup — otherwise it
    // throws `currencyNotConnected` (a 404) from inside the conversion. Idempotent
    // and joins the active transaction, mirroring the shared-account write path.
    if (subscription.expectedCurrencyCode && subscription.expectedCurrencyCode !== account.currency.code) {
      await ensureUserCurrencyConnected({
        userId: subscription.userId,
        currencyCode: subscription.expectedCurrencyCode,
      });
    }

    let converted: Money | null;
    try {
      converted = await convertSubscriptionAmountToAccountCurrency({
        subscription,
        accountCurrencyCode: account.currency.code,
        date: effectiveTime,
      });
    } catch (error) {
      // No exchange rate exists for this currency/date. Surface a clean validation
      // error — the caller can retry with an explicit `amount` — rather than letting
      // the rate service's UnexpectedError bubble up as a 500.
      if (error instanceof UnexpectedError) {
        throw new ValidationError({
          message: `No exchange rate is available to convert ${subscription.expectedCurrencyCode} to ${account.currency.code}. Provide the amount manually.`,
        });
      }
      throw error;
    }

    if (converted == null) {
      throw new ValidationError({
        message: 'A created transaction requires an amount.',
      });
    }
    amountMoney = converted;
  }

  const categoryId =
    subscription.categoryId ?? (await Users.getUserDefaultCategory({ id: subscription.userId })) ?? undefined;

  const tagIds = await getSubscriptionTagIds({ subscriptionId: subscription.id });

  return {
    userId: subscription.userId,
    accountId: subscription.accountId,
    amount: amountMoney,
    transactionType: subscription.transactionType,
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    categoryId,
    payeeId: subscription.payeeId ?? undefined,
    // Even an empty tagIds array makes createTransaction skip the Payee's own
    // default tags. Pass undefined to leave that rule in charge.
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    time: effectiveTime,
    note: subscription.name,
  };
}
