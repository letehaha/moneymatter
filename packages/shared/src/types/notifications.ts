import type { RecordId } from './record-id';
import type { ResourceType, SharePermission, SharePolicy } from './sharing';
import type { TagReminderFrequency, TagReminderType } from './tags';

/**
 * Known notification types. Using string literals (not enum) to allow
 * adding new types without migrations. These are the currently supported types.
 */
export const NOTIFICATION_TYPES = {
  budgetAlert: 'budget_alert',
  system: 'system',
  changelog: 'changelog',
  tagReminder: 'tag_reminder',
  subscriptionReminder: 'subscription_reminder',
  /** A bank sync confirmed N planned transactions by merging real rows into them. */
  plannedConfirmed: 'planned_confirmed',
  /** Enable Banking rows still pending after a week; the user should check them with the bank. */
  stuckPending: 'stuck_pending',
  shareInvitationReceived: 'share_invitation_received',
  shareInvitationSendFailed: 'share_invitation_send_failed',
  shareAccepted: 'share_accepted',
  shareDeclined: 'share_declined',
  shareRevoked: 'share_revoked',
  shareLeft: 'share_left',
  shareExpired: 'share_expired',
  shareOwnerAccountDeleted: 'share_owner_account_deleted',
  /** Recipient-side: owner deleted a budget that was shared with the recipient. Distinct
   *  from `shareRevoked` because the resource itself is gone – there's nothing to
   *  re-share, and any deep-link will 404. */
  shareOwnerBudgetDeleted: 'share_owner_budget_deleted',
  // Household membership lifecycle. Mirrors the per-resource set except for
  // the deleted-resource analog (a household has no single resource to delete)
  // and adds `householdMemberAccountDeleted` to distinguish system cascades
  // from voluntary `householdLeft`.
  householdInvitationReceived: 'household_invitation_received',
  householdInvitationSendFailed: 'household_invitation_send_failed',
  householdAccepted: 'household_accepted',
  householdDeclined: 'household_declined',
  householdPermissionChanged: 'household_permission_changed',
  householdRevoked: 'household_revoked',
  householdLeft: 'household_left',
  householdExpired: 'household_expired',
  householdOwnerAccountDeleted: 'household_owner_account_deleted',
  householdMemberAccountDeleted: 'household_member_account_deleted',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * Notification status
 */
export const NOTIFICATION_STATUSES = {
  unread: 'unread',
  read: 'read',
  dismissed: 'dismissed',
} as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[keyof typeof NOTIFICATION_STATUSES];

/**
 * Notification priority levels
 */
export const NOTIFICATION_PRIORITIES = {
  low: 'low',
  normal: 'normal',
  high: 'high',
  urgent: 'urgent',
} as const;

export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[keyof typeof NOTIFICATION_PRIORITIES];

/**
 * Type-specific payload structures for notifications.
 * Using discriminated union pattern for type safety.
 */
export interface BudgetAlertPayload {
  budgetId: RecordId;
  budgetName: string;
  thresholdPercent: number;
  currentSpent: number;
  limitAmount: number;
  currencyCode: string;
}

export interface SystemNotificationPayload {
  code?: string;
  details?: Record<string, unknown>;
}

export interface ChangelogNotificationPayload {
  version: string;
  releaseName: string;
  releaseUrl: string;
  releaseDate: string;
}

export interface TagReminderNotificationPayload {
  tagId: RecordId;
  tagName: string;
  tagColor?: string | null;
  tagIcon?: string | null;
  reminderType: TagReminderType;
  /** Schedule info for context in notification */
  schedule?: {
    frequency?: TagReminderFrequency | null;
    dayOfMonth?: number | null;
  };
  /** Amount threshold in cents (integers) */
  thresholdAmount?: number;
  /** Actual amount spent in cents (integers) */
  actualAmount?: number;
  transactionCount?: number;
  currencyCode?: string;
  /** IDs of transactions that triggered this reminder */
  transactionIds?: string[];
}

export interface StuckPendingNotificationPayload {
  transactionIds: RecordId[];
}

/**
 * Common metadata about a share-related notification's owner / recipient pair.
 * The recipient's perspective uses `owner` fields; the owner's perspective uses `recipient` fields.
 */
export interface ShareInvitationNotificationPayload {
  invitationId: RecordId;
  /** Single-use token used to deep-link to the accept/decline page (`/shared-with-me/invitations/:token`).
   * Required so the frontend notification handler can navigate without an extra lookup. */
  token: string;
  /** Reusable across notification types: 'account', 'budget', etc. */
  resourceType: ResourceType;
  /** String-encoded resource id, matches `ResourceShares.resourceId` shape. */
  resourceId: string;
  /** Resource display label captured at notification time (e.g., account name). */
  resourceName: string;
  permission: SharePermission;
  /** Sender's display info, denormalized so notification list doesn't N+1. */
  owner: {
    id: number;
    username: string;
    avatar: string | null;
  };
  /** ISO timestamp when the invitation expires (only for `share_invitation_received`). */
  expiresAt?: string;
}

export interface ShareLifecycleNotificationPayload {
  shareId?: RecordId;
  invitationId?: RecordId;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  permission?: SharePermission;
  /** Present on permission-change notifications so the recipient's UI can render the active write scope. */
  policy?: SharePolicy | null;
  /** The other party in the share – recipient (for owner-side notifications) or owner (for recipient-side). */
  counterpartUser: {
    id: number;
    username: string;
    avatar: string | null;
  };
}

/**
 * Owner-side notification fired when the inline Resend email for an invitation rejected
 * or errored after the DB row was already committed. The invitation stays in `pending` –
 * this surfaces the delivery failure as a durable record so the owner can resend from the
 * UI without having to remember the API response.
 */
export interface ShareInvitationSendFailedPayload {
  invitationId: RecordId;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  inviteeEmail: string;
  /** Present when the invitee resolved to a registered user. `null` otherwise. */
  inviteeSnapshot: {
    id: number;
    username: string;
    avatar: string | null;
  } | null;
}

export type NotificationPayload =
  | BudgetAlertPayload
  | SystemNotificationPayload
  | ChangelogNotificationPayload
  | TagReminderNotificationPayload
  | StuckPendingNotificationPayload
  | ShareInvitationNotificationPayload
  | ShareLifecycleNotificationPayload
  | ShareInvitationSendFailedPayload
  | Record<string, unknown>;

export interface NotificationModel {
  id: RecordId;
  userId: number;
  type: NotificationType;
  title: string;
  message: string | null;
  payload: NotificationPayload;
  status: NotificationStatus;
  priority: NotificationPriority;
  createdAt: Date;
  readAt: Date | null;
  expiresAt: Date | null;
}
