import { isTerminalStripeStatus } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import type Stripe from 'stripe';

import { revokeLifetimePurchase } from './lifetime-purchase.service';
import { getStripeClient } from './stripe/client';

type RefundEvent = Stripe.ChargeRefundedEvent | Stripe.ChargeDisputeClosedEvent;

const REFUND_EVENT_TYPES: readonly RefundEvent['type'][] = ['charge.refunded', 'charge.dispute.closed'];

export const isRefundEvent = (event: Stripe.Event): event is RefundEvent =>
  (REFUND_EVENT_TYPES as readonly string[]).includes(event.type);

/** Invoices that buy a billing period. Prorations and one-offs are not the subscription itself. */
const PERIOD_INVOICE_REASONS: readonly Stripe.Invoice.BillingReason[] = ['subscription_create', 'subscription_cycle'];

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  typeof ref === 'string' ? ref : (ref?.id ?? null);

/** The payment whose money is gone for good; null for a partial refund or a dispute not lost in full. */
const fullyLostPaymentIntentId = async ({
  event,
  stripe,
}: {
  event: RefundEvent;
  stripe: Stripe;
}): Promise<string | null> => {
  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    return charge.refunded ? idOf(charge.payment_intent) : null;
  }
  const dispute = event.data.object;
  if (dispute.status !== 'lost') return null;
  const charge = await stripe.charges.retrieve(typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id);
  // A dispute settled in another currency cannot be sized against the charge, so it counts as lost in full.
  const lostInFull = dispute.currency !== charge.currency || dispute.amount >= charge.amount - charge.amount_refunded;
  return lostInFull ? idOf(dispute.payment_intent) : null;
};

/** The subscription whose still-running period this payment bought, if any. */
const paidPeriodSubscriptionId = async ({
  paymentIntentId,
  stripe,
}: {
  paymentIntentId: string;
  stripe: Stripe;
}): Promise<string | null> => {
  const payments = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: paymentIntentId },
    status: 'paid',
    expand: ['data.invoice'],
  });
  const now = Date.now() / 1000;
  for (const { invoice } of payments.data) {
    if (typeof invoice === 'string' || invoice.deleted) continue;
    if (!invoice.billing_reason || !PERIOD_INVOICE_REASONS.includes(invoice.billing_reason)) continue;
    const lines = invoice.lines.has_more
      ? (await stripe.invoices.listLineItems(invoice.id, { limit: 100 })).data
      : invoice.lines.data;
    if (!lines.some((line) => line.period.end > now)) continue;
    const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
    if (subscriptionId) return subscriptionId;
  }
  return null;
};

/**
 * Stripe, as merchant of record, can refund a buyer without us. Money gone for the
 * current period ends the subscription now; the cancel echoes back as
 * `customer.subscription.deleted`, so the mirror follows through the usual path.
 * A lost one-time lifetime payment revokes the plan it bought instead.
 */
export async function handleBillingRefund({
  event,
}: {
  event: RefundEvent;
}): Promise<'canceled' | 'revoked' | 'ignored'> {
  const stripe = getStripeClient();
  const paymentIntentId = await fullyLostPaymentIntentId({ event, stripe });
  if (!paymentIntentId) return 'ignored';

  const subscriptionId = await paidPeriodSubscriptionId({ paymentIntentId, stripe });
  if (!subscriptionId) {
    if (await revokeLifetimePurchase({ paymentIntentId, stripe })) return 'revoked';
    logger.warn(
      `Billing refund ${event.type} ${event.id}: ${paymentIntentId} bought no running period or held lifetime plan, nothing ended`,
    );
    return 'ignored';
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (isTerminalStripeStatus(subscription)) return 'ignored';

  await stripe.subscriptions.cancel(subscriptionId);
  logger.info(`Billing refund ${event.type} ${event.id}: canceled ${subscriptionId}`);
  return 'canceled';
}
