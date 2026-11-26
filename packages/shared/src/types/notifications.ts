import type { ASSET_CLASS } from './investments/enums';
import type { RecordId } from './record-id';
import type { ResourceType, SharePermission, SharePolicy } from './sharing';
import type { RemindBeforePreset, SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_INTERVAL_UNITS } from './subscriptions';
import type { TagReminderFrequency, TagReminderType } from './tags';
import type { WatchlistAlertNotificationPayload } from './watchlist';

/**
 * Known notification types. Using string literals (not enum) to allow
 * adding new types without migrations. These are the currently supported types.
 */
export const NOTIFICATION_TYPES = {
  trackerAlert: 'tracker_alert',
  system: 'system',
  changelog: 'changelog',
  tagReminder: 'tag_reminder',
  subscriptionReminder: 'subscription_reminder',
  /** A bank sync confirmed N planned transactions by merging real rows into them. */
  plannedConfirmed: 'planned_confirmed',
  /** Enable Banking rows still pending after a week; the user should check them with the bank. */
  stuckPending: 'stuck_pending',
  /** A smart tracking scan linked or suggested transactions for a tracker. */
  trackerAiMatches: 'tracker_ai_matches',
  goalReached: 'goal_reached',
  unrealizedLossAlert: 'unrealized_loss_alert',
  watchlistAlert: 'watchlist_alert',
  shareInvitationReceived: 'share_invitation_received',
  shareInvitationSendFailed: 'share_invitation_send_failed',
  shareAccepted: 'share_accepted',
  shareDeclined: 'share_declined',
  shareRevoked: 'share_revoked',
  shareLeft: 'share_left',
  shareExpired: 'share_expired',
  shareOwnerAccountDeleted: 'share_owner_account_deleted',
  /** Recipient-side: owner deleted a tracker that was shared with the recipient. Distinct
   *  from `shareRevoked` because the resource itself is gone – there's nothing to
   *  re-share, and any deep-link will 404. */
  shareOwnerTrackerDeleted: 'share_owner_tracker_deleted',
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
export interface TrackerAlertPayload {
  trackerId: RecordId;
  trackerName: string;
  thresholdPercent: number;
  currentSpent: number;
  limitAmount: number;
  currencyCode: string;
}

export const SYSTEM_NOTIFICATION_ICONS = {
  info: 'info',
  announcement: 'announcement',
  success: 'success',
  warning: 'warning',
} as const;

export type SystemNotificationIcon = (typeof SYSTEM_NOTIFICATION_ICONS)[keyof typeof SYSTEM_NOTIFICATION_ICONS];

export interface SystemNotificationPayload {
  code?: string;
  details?: Record<string, unknown>;
  /** https link opened on click. */
  url?: string;
  /** Defaults to `info`. */
  icon?: SystemNotificationIcon;
}

export interface BroadcastSystemNotificationRequest {
  title: string;
  message?: string;
  url?: string;
  icon?: SystemNotificationIcon;
  /** Either one replaces the default audience (users active in the last 30 days). Omit rather than send an empty array. */
  userIds?: number[];
  emails?: string[];
}

export interface BroadcastSystemNotificationResponse {
  created: number;
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
  /** Amount threshold as a decimal */
  thresholdAmount?: number;
  /** Actual amount spent as a decimal */
  actualAmount?: number;
  transactionCount?: number;
  currencyCode?: string;
  /** IDs of transactions that triggered this reminder */
  transactionIds?: string[];
}

export interface SubscriptionReminderNotificationPayload {
  subscriptionId: RecordId;
  periodId: RecordId;
  dueDate: string;
  preset: RemindBeforePreset;
  /** Decimal; null for a subscription without an expected amount. */
  expectedAmount: number | null;
  currencyCode: string | null;
  /** Snapshot at fire time for the iOS notification card; absent on reminders created before it. */
  name?: string;
  frequency?: SUBSCRIPTION_FREQUENCIES;
  intervalCount?: number | null;
  intervalUnit?: SUBSCRIPTION_INTERVAL_UNITS | null;
  categoryName?: string | null;
  accountName?: string | null;
  logoDomain?: string | null;
  logoInitials?: string | null;
  logoColor?: string | null;
  /** `expectedAmount` in the base currency; set only when `currencyCode` differs from it and a rate exists. */
  baseAmount?: number | null;
  baseCurrencyCode?: string | null;
}

export interface TrackerAiMatchesNotificationPayload {
  trackerId: RecordId;
  trackerName: string;
  linkedCount: number;
  suggestedCount: number;
}

export interface GoalReachedNotificationPayload {
  goalId: RecordId;
  goalName: string;
  /** Decimal, goal currency. */
  achievedAmount: number;
  currencyCode: string;
}

export const UNREALIZED_LOSS_ALERT_DEFAULTS = {
  percentThreshold: 10,
  amountThreshold: 500,
} as const;

export const UNREALIZED_LOSS_ALERT_LIMITS = {
  percentThreshold: { min: 1, max: 100 },
  amountThreshold: { min: 1, max: 1_000_000_000 },
} as const;

/** Off when unset; unset thresholds fall back to `UNREALIZED_LOSS_ALERT_DEFAULTS`. */
export interface UnrealizedLossAlertsSettings {
  enabled?: boolean;
  percentThreshold?: number;
  /** Base currency. */
  amountThreshold?: number;
}

export interface UnrealizedLossAlertNotificationPayload {
  /** Base currency of `lossAmount`. */
  currencyCode: string;
  /** The thresholds the alert fired against; absent on alerts created before they were recorded. */
  percentThreshold?: number;
  amountThreshold?: number;
  holdings: Array<{
    portfolioId: RecordId;
    portfolioName: string;
    securityId: RecordId;
    symbol: string;
    assetClass?: ASSET_CLASS;
    logoUrl?: string | null;
    /** Positive percent below cost basis. */
    lossPercent: number;
    /** Positive decimal, base currency; null when the holding's rate to base is unavailable. */
    lossAmount: number | null;
  }>;
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
  /** Reusable across notification types: 'account', 'tracker', etc. */
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
  | TrackerAlertPayload
  | SystemNotificationPayload
  | ChangelogNotificationPayload
  | TagReminderNotificationPayload
  | SubscriptionReminderNotificationPayload
  | StuckPendingNotificationPayload
  | TrackerAiMatchesNotificationPayload
  | GoalReachedNotificationPayload
  | UnrealizedLossAlertNotificationPayload
  | WatchlistAlertNotificationPayload
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

export const DEVICE_TOKEN_ENVIRONMENTS = {
  sandbox: 'sandbox',
  production: 'production',
} as const;

export type DeviceTokenEnvironment = (typeof DEVICE_TOKEN_ENVIRONMENTS)[keyof typeof DEVICE_TOKEN_ENVIRONMENTS];

/** `POST /notifications/device-tokens`: `token` is the APNs device token as hex. */
export interface RegisterDeviceTokenBody {
  token: string;
  environment: DeviceTokenEnvironment;
  bundleId: string;
}

export interface NotificationChannelPreferences {
  /** Off sends nothing on any channel. */
  enabled?: boolean;
  inApp?: boolean;
  push?: boolean;
  email?: boolean;
}

/**
 * Per-category channels, stored sparse: an unset key reads from `NOTIFICATION_PREFERENCE_DEFAULTS`.
 * Each channel only narrows what the sender opts into: a watchlist alert with `notifyEmail` off sends
 * no email whatever its category says.
 */
export interface NotificationPreferences {
  watchlistAlerts?: NotificationChannelPreferences;
  /** On/off is `unrealizedLossAlerts.enabled`, which also holds the thresholds. */
  unrealizedLoss?: Omit<NotificationChannelPreferences, 'enabled'>;
  subscriptionReminders?: NotificationChannelPreferences;
  /** No email: the invitation email is the invitation itself. */
  invitations?: Omit<NotificationChannelPreferences, 'email'>;
}

export type NotificationCategory = keyof NotificationPreferences;

/** Email defaults on where the alert or subscription has its own email switch, so this only narrows it. */
export const NOTIFICATION_PREFERENCE_DEFAULTS = {
  watchlistAlerts: { enabled: true, inApp: true, push: true, email: true },
  unrealizedLoss: { inApp: true, push: true, email: false },
  subscriptionReminders: { enabled: true, inApp: true, push: true, email: true },
  invitations: { enabled: true, inApp: true, push: true },
} as const satisfies { [K in NotificationCategory]-?: Required<NonNullable<NotificationPreferences[K]>> };

export const NOTIFICATION_TYPE_CATEGORIES: Partial<Record<NotificationType, NotificationCategory>> = {
  [NOTIFICATION_TYPES.watchlistAlert]: 'watchlistAlerts',
  [NOTIFICATION_TYPES.unrealizedLossAlert]: 'unrealizedLoss',
  [NOTIFICATION_TYPES.subscriptionReminder]: 'subscriptionReminders',
  [NOTIFICATION_TYPES.shareInvitationReceived]: 'invitations',
  [NOTIFICATION_TYPES.householdInvitationReceived]: 'invitations',
};

/** Push implies in-app: opening a push lands on its in-app notification, so turning push on keeps the row. */
export const getNotificationChannels = ({
  category,
  preferences,
}: {
  category: NotificationCategory;
  preferences: NotificationPreferences | undefined;
}): Required<Omit<NotificationChannelPreferences, 'enabled'>> => {
  const {
    enabled = true,
    inApp = true,
    push = true,
    email = false,
  }: NotificationChannelPreferences = {
    ...NOTIFICATION_PREFERENCE_DEFAULTS[category],
    ...preferences?.[category],
  };
  return { inApp: enabled && (inApp || push), push: enabled && push, email: enabled && email };
};
