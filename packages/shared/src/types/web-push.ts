import { NOTIFICATION_TYPES, type NotificationType } from './notifications';

/**
 * Preference groups for Web Push. Many notification types are too many switches, so a user
 * toggles a group and every type maps into exactly one of them.
 */
export const PUSH_GROUPS = {
  reminders: 'reminders',
  bankSync: 'bankSync',
  sharing: 'sharing',
  system: 'system',
  releases: 'releases',
} as const;

export type PushGroup = (typeof PUSH_GROUPS)[keyof typeof PUSH_GROUPS];

/**
 * Total on purpose: a new `NotificationType` does not compile until it is placed in a group.
 */
export const NOTIFICATION_PUSH_GROUP: Record<NotificationType, PushGroup> = {
  [NOTIFICATION_TYPES.subscriptionReminder]: PUSH_GROUPS.reminders,
  [NOTIFICATION_TYPES.tagReminder]: PUSH_GROUPS.reminders,
  [NOTIFICATION_TYPES.trackerAlert]: PUSH_GROUPS.reminders,
  [NOTIFICATION_TYPES.trackerAiMatches]: PUSH_GROUPS.reminders,
  [NOTIFICATION_TYPES.goalReached]: PUSH_GROUPS.reminders,

  [NOTIFICATION_TYPES.plannedConfirmed]: PUSH_GROUPS.bankSync,
  [NOTIFICATION_TYPES.stuckPending]: PUSH_GROUPS.bankSync,

  [NOTIFICATION_TYPES.shareInvitationReceived]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.shareInvitationSendFailed]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.shareAccepted]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.shareDeclined]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.shareRevoked]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.shareLeft]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.shareExpired]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.shareOwnerAccountDeleted]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.shareOwnerTrackerDeleted]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.householdInvitationReceived]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.householdInvitationSendFailed]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.householdAccepted]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.householdDeclined]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.householdPermissionChanged]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.householdRevoked]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.householdLeft]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.householdExpired]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.householdOwnerAccountDeleted]: PUSH_GROUPS.sharing,
  [NOTIFICATION_TYPES.householdMemberAccountDeleted]: PUSH_GROUPS.sharing,

  [NOTIFICATION_TYPES.system]: PUSH_GROUPS.system,

  [NOTIFICATION_TYPES.changelog]: PUSH_GROUPS.releases,
};

/**
 * Value of each group when the user never set it. `releases` is off because a release
 * notification fans out to every active user.
 */
export const PUSH_GROUP_DEFAULTS: Record<PushGroup, boolean> = {
  [PUSH_GROUPS.reminders]: true,
  [PUSH_GROUPS.bankSync]: true,
  [PUSH_GROUPS.sharing]: true,
  [PUSH_GROUPS.system]: true,
  [PUSH_GROUPS.releases]: false,
};

/** Top-level discriminator of a Declarative Web Push message. */
export const DECLARATIVE_WEB_PUSH_MAGIC = 8030;

export const WEB_PUSH_MESSAGE_KINDS = {
  notification: 'notification',
  test: 'test',
} as const;

export type WebPushMessageKind = (typeof WEB_PUSH_MESSAGE_KINDS)[keyof typeof WEB_PUSH_MESSAGE_KINDS];

/** What the service worker and the app read back from `notification.data`. */
export interface WebPushNotificationData {
  v: 1;
  kind: WebPushMessageKind;
  notificationId?: string;
  type?: NotificationType;
  /** App route, e.g. `/notifications/<id>` */
  path: string;
  unreadCount: number;
}

/**
 * Payload sent to the push service: the Declarative Web Push JSON with `mutable: true`, so
 * browsers with declarative support still run the worker's `push` handler.
 */
export interface WebPushMessage {
  web_push: typeof DECLARATIVE_WEB_PUSH_MAGIC;
  mutable: true;
  notification: {
    title: string;
    body?: string;
    /** Absolute URL the browser opens when it shows the notification itself */
    navigate: string;
    lang: string;
    tag: string;
    silent: false;
    data: WebPushNotificationData;
  };
}

export interface PushConfigResponse {
  enabled: boolean;
  vapidPublicKey: string | null;
}

/** `PushSubscription.toJSON()` plus the app-level fields. */
export interface SubscribePushRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
  deviceLabel?: string | null;
  /** Set only by a rotation: the endpoint this subscription replaces. */
  oldEndpoint?: string;
}

export interface PushDeviceDto {
  id: string;
  deviceLabel: string | null;
  endpointHost: string;
  /** First 16 hex characters of SHA-256 over the endpoint */
  endpointHash: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
}

export interface SyncPushSubscriptionRequest {
  endpoint: string;
}

export interface SyncPushSubscriptionResponse {
  known: boolean;
}

export interface UnsubscribePushRequest {
  endpoint: string;
}

export interface SendTestPushResponse {
  sent: number;
  failed: number;
  removed: number;
}
