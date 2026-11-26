import { GIFT_CODE_VALID_MONTHS, GIFT_DURATION_MONTHS } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import Gifts from '@models/gifts.model';
import { PLAN_BILLING_URL } from '@root/config';
import { appName, buildEmailShell, escapeHtml, fromEmail } from '@services/email';
import { sendEmail } from '@services/email/send-email';
import { addMonths } from 'date-fns';
import { Op } from 'sequelize';

import { SUPPORT_EMAIL, planName } from '../send-subscription-welcome-email';

const formatGiftCode = ({ code }: { code: string }) => code.match(/.{1,4}/g)!.join('-');

const formatDate = ({ date }: { date: Date }) =>
  date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

const paragraph = ({ html }: { html: string }) => `<p style="margin: 0 0 12px 0;">${html}</p>`;

const buildRecipientHtml = ({ gift }: { gift: Gifts }): string => {
  const code = formatGiftCode({ code: gift.code });
  const link = `${PLAN_BILLING_URL}?gift=${encodeURIComponent(code)}`;
  const note = gift.message
    ? `<tr><td style="padding: 0 40px 16px 40px;"><div style="border-left: 3px solid #8b5cf6; padding: 8px 16px; font-size: 15px; color: #1a1a1a; line-height: 1.5; white-space: pre-line;">${escapeHtml(gift.message)}</div></td></tr>`
    : '';
  return buildEmailShell({
    innerHtml: `
          <tr><td style="padding: 28px 40px 0 40px;"><h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1a1a1a; line-height: 1.3;">${escapeHtml(gift.buyerName)} sent you a gift</h1></td></tr>
          <tr><td style="padding: 16px 40px 16px 40px; font-size: 15px; color: #1a1a1a; line-height: 1.5;">
            ${paragraph({ html: `Hi ${escapeHtml(gift.recipientName)}, you've been given ${GIFT_DURATION_MONTHS} months of ${escapeHtml(planName({ tier: gift.tier }))}, the personal finance app for tracking accounts, budgets and investments in one place.` })}
          </td></tr>
          ${note}
          <tr><td style="padding: 0 40px 8px 40px; font-size: 15px; color: #1a1a1a;">Your gift code:</td></tr>
          <tr><td style="padding: 0 40px 20px 40px;"><span style="display: inline-block; font-family: ui-monospace, Menlo, monospace; font-size: 20px; font-weight: 700; letter-spacing: 1px; background: #f4f4f5; border-radius: 8px; padding: 10px 16px; color: #1a1a1a;">${code}</span></td></tr>
          <tr><td style="padding: 0 40px 24px 40px;"><a href="${link}" style="display: inline-block; background: #8b5cf6; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 24px; border-radius: 8px;">Redeem your gift</a></td></tr>
          <tr><td style="padding: 0 40px 36px 40px; font-size: 13px; color: #6b7280; line-height: 1.5;">
            ${paragraph({ html: `New to ${escapeHtml(appName)}? Create a free account first, then open the link again or enter the code in Settings → Plan &amp; billing. The code works once and stays valid until ${formatDate({ date: giftCodeExpiresAt({ sentAt: gift.sentAt ?? new Date() }) })}.` })}
            ${paragraph({ html: `Anyone with this code can redeem it, so keep this email to yourself. Questions? Write to <a href="mailto:${SUPPORT_EMAIL}" style="color: #7c3aed;">${SUPPORT_EMAIL}</a>.` })}
          </td></tr>`,
  });
};

const buildBuyerHtml = ({ gift }: { gift: Gifts }): string =>
  buildEmailShell({
    innerHtml: `
          <tr><td style="padding: 28px 40px 0 40px;"><h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1a1a1a; line-height: 1.3;">Your gift is on its way</h1></td></tr>
          <tr><td style="padding: 16px 40px 36px 40px; font-size: 15px; color: #1a1a1a; line-height: 1.5;">
            ${paragraph({ html: `Thank you, ${escapeHtml(gift.buyerName)}. ${escapeHtml(gift.recipientName)} (${escapeHtml(gift.recipientEmail)}) gets ${GIFT_DURATION_MONTHS} months of ${escapeHtml(planName({ tier: gift.tier }))}.` })}
            ${paragraph({ html: gift.deliverAt.getTime() > Date.now() ? "We'll email them the gift code on the day you picked." : 'We have just emailed them the gift code.' })}
            ${paragraph({ html: `Wrong email address, or need a refund? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color: #7c3aed;">${SUPPORT_EMAIL}</a>.` })}
          </td></tr>`,
  });

export const giftCodeExpiresAt = ({ sentAt }: { sentAt: Date }) => addMonths(sentAt, GIFT_CODE_VALID_MONTHS);

/** Best-effort: the purchase already stands, so a failed send is only logged. */
export async function sendGiftBuyerConfirmation({ gift }: { gift: Gifts }): Promise<void> {
  try {
    const result = await sendEmail({
      from: `${appName} <${fromEmail}>`,
      to: gift.buyerEmail,
      replyTo: SUPPORT_EMAIL,
      subject: `Your ${planName({ tier: gift.tier })} gift for ${gift.recipientName}`,
      html: buildBuyerHtml({ gift }),
    });
    if (result?.error) throw new Error(`${result.error.name}: ${result.error.message}`);
  } catch (error) {
    logger.error({ message: '[GiftBuyerEmail] Failed to send', error: error as Error }, { giftId: gift.id });
  }
}

/**
 * Claims the gift by stamping `sentAt` before sending, so two runs never both email it.
 * A failed send clears the stamp again and the next run retries.
 */
export async function deliverGift({ giftId }: { giftId: string }): Promise<boolean> {
  const now = new Date();
  const [, rows] = await Gifts.update(
    { sentAt: now },
    {
      where: { id: giftId, sentAt: null, refundedAt: null, deliverAt: { [Op.lte]: now } },
      returning: true,
    },
  );
  const gift = rows[0];
  if (!gift) return false;

  try {
    const result = await sendEmail({
      from: `${appName} <${fromEmail}>`,
      to: gift.recipientEmail,
      replyTo: SUPPORT_EMAIL,
      subject: `${gift.buyerName} sent you ${GIFT_DURATION_MONTHS} months of ${planName({ tier: gift.tier })}`,
      html: buildRecipientHtml({ gift }),
    });
    if (result?.error) throw new Error(`${result.error.name}: ${result.error.message}`);
    return true;
  } catch (error) {
    logger.error(
      { message: '[GiftEmail] Failed to send, will retry', error: error as Error },
      { code: 'GIFT_DELIVERY_EMAIL_FAILED', giftId },
    );
    try {
      await Gifts.update({ sentAt: null }, { where: { id: giftId } });
    } catch (resetError) {
      logger.error(
        {
          message: '[GiftEmail] Failed to release the claim, the gift will not be retried',
          error: resetError as Error,
        },
        { code: 'GIFT_DELIVERY_RESET_FAILED', giftId },
      );
    }
    return false;
  }
}

export async function deliverDueGifts(): Promise<{ sent: number; failed: number }> {
  const due = await Gifts.findAll({
    where: { sentAt: null, refundedAt: null, deliverAt: { [Op.lte]: new Date() } },
    attributes: ['id'],
  });
  let sent = 0;
  for (const { id } of due) {
    if (await deliverGift({ giftId: id })) sent += 1;
  }
  return { sent, failed: due.length - sent };
}
