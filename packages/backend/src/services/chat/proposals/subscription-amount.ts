import { ValidationError } from '@js/errors';
import Subscriptions from '@models/subscriptions.model';
import { assertAmountCurrencyConsistent } from '@services/subscriptions/helpers';

import { findProposalRefs, ToolInputError } from './placeholders';

/**
 * An update that would leave a subscription with an amount and no currency, or the reverse, fails when it is
 * approved. The account of a subscription does not decide the currency of its expected amount, so none is assumed:
 * the model is told to pass the missing half, and no card is made.
 */
export async function assertSubscriptionAmountHasCurrency({
  userId,
  args,
}: {
  userId: number;
  args: Record<string, unknown>;
}): Promise<void> {
  const { id, expectedAmount, expectedCurrencyCode } = args;
  if (expectedAmount === undefined && expectedCurrencyCode === undefined) return;
  if (typeof id !== 'string' || findProposalRefs({ value: id }).length > 0) return;

  const stored = await Subscriptions.findOne({
    where: { id, userId },
    attributes: ['expectedAmount', 'expectedCurrencyCode'],
  });
  if (!stored) return;

  const amount = expectedAmount !== undefined ? (expectedAmount as number | null) : stored.expectedAmount;
  const currency =
    expectedCurrencyCode !== undefined ? (expectedCurrencyCode as string | null) : stored.expectedCurrencyCode;

  try {
    assertAmountCurrencyConsistent({ expectedAmount: amount, expectedCurrencyCode: currency });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;

    const missing = amount != null ? 'expectedCurrencyCode' : 'expectedAmount';
    throw new ToolInputError(
      `${missing}: this call would leave the subscription with only one of expectedAmount and expectedCurrencyCode. Pass ${missing} in the same call. The account does not set the currency of the amount.`,
    );
  }
}
