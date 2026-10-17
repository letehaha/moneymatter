import {
  NOTIFICATION_TYPES,
  type ChangelogNotificationPayload,
  type NotificationModel,
  type NotificationType,
  SHARE_NOTIFICATION_TYPES,
  type ShareInvitationNotificationPayload,
  type ShareInvitationSendFailedPayload,
  type ShareLifecycleNotificationPayload,
  TAG_REMINDER_TYPES,
  type TagReminderNotificationPayload,
} from '@bt/shared/types';
import { t } from '@i18n/index';

type RenderableNotification = Pick<NotificationModel, 'type' | 'message' | 'payload'>;

const DEFAULT_CURRENCY = 'USD';
const MAX_PLAIN_AMOUNT_FRACTION_DIGITS = 8;
const FALLBACK_LOCALE = 'en';

const RECEIVED_TYPES: readonly NotificationType[] = [
  NOTIFICATION_TYPES.shareInvitationReceived,
  NOTIFICATION_TYPES.householdInvitationReceived,
];
const SEND_FAILED_TYPES: readonly NotificationType[] = [
  NOTIFICATION_TYPES.shareInvitationSendFailed,
  NOTIFICATION_TYPES.householdInvitationSendFailed,
];

const withNumberFormat = <T>({
  locale,
  options,
  format,
}: {
  locale: string;
  options?: Intl.NumberFormatOptions;
  format: (formatter: Intl.NumberFormat) => T;
}): T => {
  try {
    return format(new Intl.NumberFormat(locale, options));
  } catch (error) {
    // Only a malformed locale reaches here; `en` keeps the push readable.
    if (locale === FALLBACK_LOCALE) throw error;
    return format(new Intl.NumberFormat(FALLBACK_LOCALE, options));
  }
};

/**
 * Formats like the bell's `formatAmountByCurrencyCode`: a currency amount for a code `Intl`
 * accepts, else the plain number followed by the code (a custom currency code such as `MYCOIN`).
 */
const formatAmount = ({ amount, currencyCode, locale }: { amount: number; currencyCode: string; locale: string }) => {
  try {
    return withNumberFormat({
      locale,
      options: { style: 'currency', currency: currencyCode },
      format: (formatter) => formatter.format(amount),
    });
  } catch {
    const plain = withNumberFormat({
      locale,
      options: { maximumFractionDigits: MAX_PLAIN_AMOUNT_FRACTION_DIGITS },
      format: (formatter) => formatter.format(amount),
    });
    return `${plain} ${currencyCode}`;
  }
};

const renderChangelogBody = ({ payload }: { payload: ChangelogNotificationPayload }): string | null =>
  payload.releaseName || null;

const renderTagReminderBody = ({
  payload,
  locale,
}: {
  payload: TagReminderNotificationPayload;
  locale: string;
}): string | null => {
  const currencyCode = payload.currencyCode || DEFAULT_CURRENCY;
  const format = ({ amount }: { amount: number | undefined }) =>
    amount === undefined ? '' : formatAmount({ amount, currencyCode, locale });

  let message = '';
  if (payload.reminderType === TAG_REMINDER_TYPES.amountThreshold) {
    message = t({
      key: 'webPush.body.tagReminderThreshold',
      variables: {
        amount: format({ amount: payload.actualAmount }),
        threshold: format({ amount: payload.thresholdAmount }),
      },
      locale,
    });
  } else if (payload.reminderType === TAG_REMINDER_TYPES.existenceCheck) {
    message = t({
      key: 'webPush.body.tagReminderExistence',
      variables: { count: payload.transactionCount ?? 0 },
      locale,
    });
  }

  return [payload.tagName, message].filter(Boolean).join(' · ') || null;
};

const renderCounterpart = ({
  type,
  payload,
}: {
  type: NotificationType;
  payload: Record<string, any>;
}): string | null => {
  if (RECEIVED_TYPES.includes(type)) {
    const { owner } = payload as Partial<ShareInvitationNotificationPayload>;
    return owner?.username ? `@${owner.username}` : null;
  }

  if (SEND_FAILED_TYPES.includes(type)) {
    const { inviteeSnapshot, inviteeEmail } = payload as Partial<ShareInvitationSendFailedPayload>;
    if (inviteeSnapshot?.username) return `@${inviteeSnapshot.username}`;
    return inviteeEmail || null;
  }

  const { counterpartUser } = payload as Partial<ShareLifecycleNotificationPayload>;
  return counterpartUser?.username ? `@${counterpartUser.username}` : null;
};

const renderShareBody = ({
  type,
  payload,
  locale,
}: {
  type: NotificationType;
  payload: Record<string, any>;
  locale: string;
}): string | null => {
  const counterpart = renderCounterpart({ type, payload });
  const { resourceName } = payload as { resourceName?: string };

  const line = [counterpart, resourceName].filter(Boolean).join(' · ');
  // The bell shows the hint only under a counterpart or resource line.
  if (!line) return null;

  return SEND_FAILED_TYPES.includes(type) ? `${line}\n${t({ key: 'webPush.body.shareSendFailedHint', locale })}` : line;
};

/**
 * The text under the push title, mirroring what the bell shows per type (`notification-item.vue`
 * and its content components). `null` means no body.
 */
export const renderPushBody = ({
  notification,
  locale,
}: {
  notification: RenderableNotification;
  locale: string;
}): string | null => {
  const payload = (notification.payload ?? {}) as Record<string, any>;

  if (notification.type === NOTIFICATION_TYPES.changelog) {
    return renderChangelogBody({ payload: payload as ChangelogNotificationPayload });
  }

  if (notification.type === NOTIFICATION_TYPES.tagReminder) {
    return renderTagReminderBody({ payload: payload as TagReminderNotificationPayload, locale });
  }

  if (SHARE_NOTIFICATION_TYPES.includes(notification.type)) {
    return renderShareBody({ type: notification.type, payload, locale });
  }

  return notification.message || null;
};
