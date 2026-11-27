import {
  RESOURCE_TYPES,
  ResourceType,
  SHARE_PERMISSIONS,
  ShareInvitationEmailOutcome,
  SharePermission,
  SharePolicy,
  TRANSACTIONS_WRITE_SCOPES,
  isTestEmail,
} from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { appName, appUrl, buildEmailShell, escapeHtml, fromEmail, resend } from '@services/email';

const PERMISSION_LABELS: Record<SharePermission, string> = {
  [SHARE_PERMISSIONS.read]: 'View only',
  [SHARE_PERMISSIONS.write]: 'Can edit',
  [SHARE_PERMISSIONS.manage]: 'Can manage',
};

const TRACKER_PERMISSION_LABELS: Record<SharePermission, string> = {
  [SHARE_PERMISSIONS.read]: 'View only',
  [SHARE_PERMISSIONS.write]: 'Attach own transactions',
  [SHARE_PERMISSIONS.manage]: 'Manage',
};

// Household invitations have their own email template — this map is only hit
// for per-resource invitations. Keep the household entry for type
// exhaustiveness; if it ever appears in copy, the wording is reasonable.
const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  account: 'account',
  household: 'household',
  tracker: 'tracker',
};

const policySummary = ({ permission, policy }: { permission: SharePermission; policy: SharePolicy | null }) => {
  if (permission === SHARE_PERMISSIONS.read) return null;
  const scope = policy?.transactionsWriteScope ?? TRANSACTIONS_WRITE_SCOPES.all;
  return scope === TRANSACTIONS_WRITE_SCOPES.own
    ? 'Can edit only transactions they create themselves.'
    : 'Can edit any transaction on the account.';
};

interface SendInvitationEmailParams {
  toEmail: string;
  ownerDisplayName: string;
  resourceType: ResourceType;
  resourceName: string;
  permission: SharePermission;
  policy: SharePolicy | null;
  token: string;
  expiresAt: Date;
  /** Drives the "create an account with this email to accept" hint for invitees who
   *  don't have an account yet. */
  recipientIsRegistered: boolean;
}

/**
 * Outcome of an inline send. Callers surface each case differently: `'sent'` and
 * `'skipped'` (no email provider configured) are silent, `'failed'` warns the inviter that
 * the row exists but nothing was delivered.
 */
type SendInvitationEmailOutcome =
  | { status: 'sent'; messageId: string | null }
  | { status: Exclude<ShareInvitationEmailOutcome, 'sent'> };

/**
 * Sends an invitation email via Resend. Inline send (no queue) — failures are logged but
 * don't block the API response, since the in-app notification is the secondary fallback.
 *
 * Returns a tagged outcome so callers can distinguish "Resend isn't configured" from
 * "Resend tried and failed".
 */
export const sendInvitationEmail = async ({
  toEmail,
  ownerDisplayName,
  resourceType,
  resourceName,
  permission,
  policy,
  token,
  expiresAt,
  recipientIsRegistered,
}: SendInvitationEmailParams): Promise<SendInvitationEmailOutcome> => {
  if (!resend) {
    logger.warn('[ShareInvitationEmail] Resend not configured; skipping send');
    return { status: 'skipped' };
  }

  if (isTestEmail(toEmail)) {
    logger.info(`[ShareInvitationEmail] Skipped (test recipient): ${toEmail}`);
    return { status: 'skipped' };
  }

  // Query-param deep-link — dashboard layout watches for `invitation_token` and pops
  // the share-invitation dialog. The landing path matches the resource flavour so the
  // recipient lands somewhere they expect to see this share even before opening the
  // dialog; the dialog itself overlays whatever route the user ended up on.
  const isTracker = resourceType === RESOURCE_TYPES.tracker;
  const landingPath = isTracker ? '/planned/trackers' : '/accounts';
  const acceptUrl = `${appUrl}${landingPath}?invitation_token=${encodeURIComponent(token)}`;
  const summaryLine = isTracker ? null : policySummary({ permission, policy });
  const html = buildEmailHtml({
    ownerDisplayName,
    resourceTypeLabel: RESOURCE_TYPE_LABELS[resourceType],
    resourceName,
    permissionLabel: (isTracker ? TRACKER_PERMISSION_LABELS : PERMISSION_LABELS)[permission],
    summaryLine,
    acceptUrl,
    expiresAt,
    recipientIsRegistered,
  });

  try {
    const result = await resend.emails.send({
      from: `${appName} <${fromEmail}>`,
      to: toEmail,
      subject: `${ownerDisplayName} invited you to "${resourceName}" on ${appName}`,
      html,
    });
    logger.info(`[ShareInvitationEmail] Sent to ${toEmail}, resendId: ${result.data?.id}`);
    return { status: 'sent', messageId: result.data?.id ?? null };
  } catch (error) {
    // Stable `code` lets ops dashboards group/alert on email-delivery failures without
    // depending on the dynamic message text or error class. logger.error already auto-captures
    // to Sentry (see logger.ts), so this is enrichment, not double-reporting.
    logger.error(
      {
        message: '[ShareInvitationEmail] Failed to send invitation email',
        error: error as Error,
      },
      { code: 'SHARE_INVITATION_EMAIL_FAILED', resourceType, resourceName },
    );
    return { status: 'failed' };
  }
};

const buildEmailHtml = ({
  ownerDisplayName,
  resourceTypeLabel,
  resourceName,
  permissionLabel,
  summaryLine,
  acceptUrl,
  expiresAt,
  recipientIsRegistered,
}: {
  ownerDisplayName: string;
  resourceTypeLabel: string;
  resourceName: string;
  permissionLabel: string;
  summaryLine: string | null;
  acceptUrl: string;
  expiresAt: Date;
  recipientIsRegistered: boolean;
}) => {
  const safeOwner = escapeHtml(ownerDisplayName);
  const safeResourceType = escapeHtml(resourceTypeLabel);
  const safeResourceName = escapeHtml(resourceName);
  const safePermission = escapeHtml(permissionLabel);
  const safeUrl = escapeHtml(acceptUrl);
  const safeExpires = escapeHtml(expiresAt.toISOString().slice(0, 10));
  const summaryRow = summaryLine
    ? `<tr><td style="padding: 0 0 6px 0; font-size: 14px; color: #6b7280;" colspan="2">${escapeHtml(summaryLine)}</td></tr>`
    : '';
  const signupHint = recipientIsRegistered
    ? ''
    : `<p style="margin: 0 0 10px 0; font-size: 13px; color: #9ca3af; line-height: 1.5;">New to ${escapeHtml(appName)}? Create an account with this email address to accept the invitation.</p>`;

  return buildEmailShell({
    innerHtml: `
          <tr><td style="padding: 28px 40px 0 40px;"><h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1a1a1a; line-height: 1.3;">${safeOwner} shared a${safeResourceType.match(/^[aeiou]/i) ? 'n' : ''} ${safeResourceType} with you</h1></td></tr>
          <tr><td style="padding: 16px 40px 0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding: 0 0 6px 0; font-size: 15px; color: #6b7280;">Resource</td><td style="padding: 0 0 6px 0; font-size: 15px; color: #1a1a1a; text-align: right;"><strong>${safeResourceName}</strong></td></tr>
              <tr><td style="padding: 0 0 6px 0; font-size: 15px; color: #6b7280;">Access</td><td style="padding: 0 0 6px 0; font-size: 15px; color: #1a1a1a; text-align: right;"><strong>${safePermission}</strong></td></tr>
              <tr><td style="padding: 0 0 12px 0; font-size: 15px; color: #6b7280;">Expires</td><td style="padding: 0 0 12px 0; font-size: 15px; color: #1a1a1a; text-align: right;"><strong>${safeExpires}</strong></td></tr>
              ${summaryRow}
            </table>
          </td></tr>
          <tr><td style="padding: 24px 40px 0 40px;">
            <a href="${safeUrl}" style="display: inline-block; background-color: #8b5cf6; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">View invitation</a>
          </td></tr>
          <tr><td style="padding: 32px 40px 36px 40px;">
            ${signupHint}
            <p style="margin: 0; font-size: 13px; color: #9ca3af; line-height: 1.5;">If you weren't expecting this invitation, you can safely ignore this email — it expires on ${safeExpires}.</p>
          </td></tr>`,
  });
};
