import type { BillingTier } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { appName, buildEmailShell, escapeHtml, fromEmail } from '@services/email';
import { sendEmail } from '@services/email/send-email';
import { getEmailForUser } from '@services/sharing/find-user-by-email.service';

export const SUPPORT_EMAIL = 'support@moneymatter.app';

export const planName = ({ tier }: { tier: string }) => `${appName} ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;

const buildSubscriptionWelcomeHtml = ({ name }: { name: string }): string =>
  buildEmailShell({
    innerHtml: `
          <tr><td style="padding: 28px 40px 0 40px;"><h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1a1a1a; line-height: 1.3;">Welcome to ${escapeHtml(name)}</h1></td></tr>
          <tr><td style="padding: 16px 40px 36px 40px; font-size: 15px; color: #1a1a1a; line-height: 1.5;">
            <p style="margin: 0 0 12px 0;">Your support is what keeps ${escapeHtml(appName)} independent, and I really appreciate it.</p>
            <p style="margin: 0 0 12px 0;">If something isn't working the way you expect, or you have an idea that would make the app better for you, just reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color: #7c3aed;">${SUPPORT_EMAIL}</a>. I read every message myself.</p>
            <p style="margin: 0 0 12px 0;">One more thing: I respect your inbox and your privacy. No newsletters and no promotions. You'll only get emails about your account, billing, or sharing, and the ones you set up yourself in the app, like reminders.</p>
            <p style="margin: 0;">Glad to have you here,<br>Dmytro</p>
          </td></tr>`,
  });

/** Best-effort: the subscription is already mirrored, so a failed send is only logged. */
export const sendSubscriptionWelcomeEmail = async ({
  userId,
  tier,
}: {
  userId: number;
  tier: BillingTier;
}): Promise<void> => {
  try {
    const to = await getEmailForUser({ userId });
    if (!to) {
      logger.warn('[SubscriptionWelcomeEmail] Skipped: no email on record', { userId, tier });
      return;
    }

    const name = planName({ tier });
    const result = await sendEmail({
      from: `${appName} <${fromEmail}>`,
      to,
      replyTo: SUPPORT_EMAIL,
      subject: `Thank you for subscribing to ${name}`,
      html: buildSubscriptionWelcomeHtml({ name }),
    });
    if (result?.error) throw new Error(`${result.error.name}: ${result.error.message}`);
    if (result) logger.info(`[SubscriptionWelcomeEmail] Sent to user ${userId}, resendId: ${result.data?.id}`);
  } catch (error) {
    logger.error(
      { message: '[SubscriptionWelcomeEmail] Failed to send', error: error as Error },
      { code: 'SUBSCRIPTION_WELCOME_EMAIL_FAILED', userId, tier },
    );
  }
};
