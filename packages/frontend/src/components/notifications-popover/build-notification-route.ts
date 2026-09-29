import type { NotificationStruct } from '@/api/notifications';
import { ROUTES_NAMES } from '@/routes/constants';
import {
  NOTIFICATION_TYPES,
  RESOURCE_TYPES,
  type ShareInvitationNotificationPayload,
  type ShareInvitationSendFailedPayload,
  type ShareLifecycleNotificationPayload,
} from '@bt/shared/types';

/**
 * Outcome of resolving a notification click.
 *
 * `spa` keeps the user inside the app — used for in-app deep-links so globally-mounted
 * dialogs (e.g. accept/decline) can pick up the query param without a full reload.
 * `external` falls back to a full navigation for targets that live outside the SPA router.
 * `null` means "not actionable" — changelog/system entries display content but don't deep-link.
 */
type NotificationRoute =
  | {
      kind: 'spa';
      to: {
        name: string;
        params?: Record<string, string | number>;
        query?: Record<string, string>;
      };
    }
  | { kind: 'external'; href: string }
  | null;

export const buildNotificationRoute = (notification: NotificationStruct): NotificationRoute => {
  switch (notification.type) {
    case NOTIFICATION_TYPES.shareInvitationReceived: {
      const payload = notification.payload as ShareInvitationNotificationPayload | undefined;
      if (!payload?.token) return null;
      return {
        kind: 'spa',
        to: { name: ROUTES_NAMES.accounts, query: { invitation_token: payload.token } },
      };
    }

    case NOTIFICATION_TYPES.shareAccepted: {
      const payload = notification.payload as ShareLifecycleNotificationPayload | undefined;
      if (payload?.resourceType !== RESOURCE_TYPES.account) return null;
      const accountId = payload.resourceId;
      if (!accountId) return null;
      return {
        kind: 'spa',
        to: { name: ROUTES_NAMES.account, params: { id: accountId } },
      };
    }

    case NOTIFICATION_TYPES.shareInvitationSendFailed: {
      // Drop the owner on the resource so they can hit "Resend" on the pending row in the
      // sharing panel without having to navigate. Currently only accounts are shareable;
      // when more resource types ship, branch the route per `resourceType`.
      const payload = notification.payload as ShareInvitationSendFailedPayload | undefined;
      if (payload?.resourceType !== RESOURCE_TYPES.account) return null;
      const accountId = payload.resourceId;
      if (!accountId) return null;
      return {
        kind: 'spa',
        to: { name: ROUTES_NAMES.account, params: { id: accountId } },
      };
    }

    case NOTIFICATION_TYPES.householdInvitationReceived: {
      const payload = notification.payload as ShareInvitationNotificationPayload | undefined;
      if (!payload?.token) return null;
      return {
        kind: 'spa',
        to: { name: ROUTES_NAMES.settingsSharedWithMe, query: { invitation_token: payload.token } },
      };
    }

    case NOTIFICATION_TYPES.householdInvitationSendFailed:
    case NOTIFICATION_TYPES.householdAccepted:
    case NOTIFICATION_TYPES.householdDeclined:
    case NOTIFICATION_TYPES.householdExpired:
    case NOTIFICATION_TYPES.householdLeft:
    case NOTIFICATION_TYPES.householdMemberAccountDeleted:
      return {
        kind: 'spa',
        to: { name: ROUTES_NAMES.settingsHousehold },
      };

    case NOTIFICATION_TYPES.householdPermissionChanged:
    case NOTIFICATION_TYPES.householdRevoked:
    case NOTIFICATION_TYPES.householdOwnerAccountDeleted:
      // Recipient-side notifications — land on /shared-with-me where the recipient
      // sees the household row (or its absence after revoke/owner-delete).
      return {
        kind: 'spa',
        to: { name: ROUTES_NAMES.settingsSharedWithMe },
      };

    case NOTIFICATION_TYPES.budgetAlert: {
      const payload = notification.payload as { budgetId?: string } | undefined;
      if (payload?.budgetId) {
        return {
          kind: 'spa',
          to: { name: ROUTES_NAMES.plannedBudgetDetails, params: { id: payload.budgetId } },
        };
      }
      return {
        kind: 'spa',
        to: { name: ROUTES_NAMES.plannedBudgets },
      };
    }

    case NOTIFICATION_TYPES.subscriptionReminder: {
      const payload = notification.payload as { subscriptionId?: string } | undefined;
      if (!payload?.subscriptionId) return null;
      return {
        kind: 'spa',
        to: { name: ROUTES_NAMES.plannedSubscriptionDetails, params: { id: payload.subscriptionId } },
      };
    }

    case NOTIFICATION_TYPES.plannedConfirmed: {
      const payload = notification.payload as { accountId?: string } | undefined;
      if (!payload?.accountId) return null;
      return {
        kind: 'spa',
        to: { name: ROUTES_NAMES.account, params: { id: payload.accountId } },
      };
    }

    case NOTIFICATION_TYPES.stuckPending:
      return {
        kind: 'spa',
        to: { name: ROUTES_NAMES.optimizationsReconciliation, query: { tab: 'stuck-pending' } },
      };

    default:
      return null;
  }
};
