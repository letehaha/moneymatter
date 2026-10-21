import {
  DECLARATIVE_WEB_PUSH_MAGIC,
  type ChangelogNotificationPayload,
  NOTIFICATION_TYPES,
  type NotificationModel,
  WEB_PUSH_MESSAGE_KINDS,
  type WebPushMessage,
} from '@bt/shared/types';
import { t } from '@i18n/index';

import { renderPushBody } from './render-push-body';

const MAX_TITLE_CODE_POINTS = 200;
const MAX_BODY_CODE_POINTS = 500;
// The encrypted record holds 3993 bytes of plaintext (RFC 8291); the rest is headroom.
const MAX_PAYLOAD_BYTES = 3000;
const ELLIPSIS = '…';

const TEST_PUSH_TAG = 'push-test';
const TEST_PUSH_PATH = '/settings/notifications';

type PushNotification = Pick<NotificationModel, 'id' | 'type' | 'title' | 'message' | 'payload'>;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const countCodePoints = ({ text }: { text: string }): number => Array.from(text).length;

/**
 * Cuts `text` to at most `max` code points including the ellipsis, on a grapheme boundary so an
 * emoji sequence is dropped whole instead of being split.
 */
const truncate = ({ text, max }: { text: string; max: number }): string => {
  if (countCodePoints({ text }) <= max) return text;

  let kept = '';
  let used = 0;
  for (const { segment } of segmenter.segment(text)) {
    const size = countCodePoints({ text: segment });
    if (used + size > max - 1) break;
    kept += segment;
    used += size;
  }

  return `${kept.trimEnd()}${ELLIPSIS}`;
};

const byteLength = ({ value }: { value: unknown }): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

const buildTitle = ({ notification, locale }: { notification: PushNotification; locale: string }): string => {
  const { version } = (notification.payload ?? {}) as Partial<ChangelogNotificationPayload>;
  const title =
    notification.type === NOTIFICATION_TYPES.changelog && version
      ? t({ key: 'webPush.newVersion', variables: { version }, locale })
      : notification.title;

  return truncate({ text: title.trim() || t({ key: 'webPush.fallbackTitle', locale }), max: MAX_TITLE_CODE_POINTS });
};

/**
 * Sets `notification.body` to the longest trim of `body` that keeps the serialized message under
 * the byte cap, or leaves it out when not even a short one fits.
 */
const attachBody = ({ message, body }: { message: WebPushMessage; body: string | null }): WebPushMessage => {
  if (!body) return message;

  const withBody = ({ max }: { max: number }): WebPushMessage => ({
    ...message,
    notification: { ...message.notification, body: truncate({ text: body, max }) },
  });

  let low = 0;
  let high = Math.min(MAX_BODY_CODE_POINTS, countCodePoints({ text: body }));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (byteLength({ value: withBody({ max: mid }) }) <= MAX_PAYLOAD_BYTES) low = mid;
    else high = mid - 1;
  }

  if (low === 0) return message;

  // A budget too small for any text leaves just the ellipsis, which is no body.
  const fitted = withBody({ max: low });
  return fitted.notification.body === ELLIPSIS && body !== ELLIPSIS ? message : fitted;
};

const buildMessage = ({
  title,
  navigate,
  locale,
  tag,
  data,
}: {
  title: string;
  navigate: string;
  locale: string;
  tag: string;
  data: WebPushMessage['notification']['data'];
}): WebPushMessage => ({
  web_push: DECLARATIVE_WEB_PUSH_MAGIC,
  // Without it Safari shows the declarative notification itself and never runs the worker.
  mutable: true,
  notification: { title, navigate, lang: locale, tag, silent: false, data },
});

/**
 * The Declarative Web Push message for a notification. `origin` is the frontend origin without a
 * trailing slash (`FRONTEND_BASE_URL`). The fields stay complete so a browser that shows the
 * notification itself still opens the right page.
 */
export const buildPushPayload = ({
  notification,
  locale,
  origin,
  unreadCount,
}: {
  notification: PushNotification;
  locale: string;
  origin: string;
  unreadCount: number;
}): WebPushMessage => {
  const path = `/notifications/${notification.id}`;

  const message = buildMessage({
    title: buildTitle({ notification, locale }),
    navigate: `${origin}${path}`,
    locale,
    tag: notification.id,
    data: {
      v: 1,
      kind: WEB_PUSH_MESSAGE_KINDS.notification,
      notificationId: notification.id,
      type: notification.type,
      path,
      unreadCount,
    },
  });

  return attachBody({ message, body: renderPushBody({ notification, locale }) });
};

/** The message behind the "send a test notification" button. */
export const buildTestPushPayload = ({
  locale,
  origin,
  unreadCount = 0,
}: {
  locale: string;
  origin: string;
  /** The user's unread count, so the test push leaves the app badge as it is. */
  unreadCount?: number;
}): WebPushMessage => {
  const message = buildMessage({
    title: t({ key: 'webPush.testTitle', locale }),
    navigate: `${origin}${TEST_PUSH_PATH}`,
    locale,
    tag: TEST_PUSH_TAG,
    data: { v: 1, kind: WEB_PUSH_MESSAGE_KINDS.test, path: TEST_PUSH_PATH, unreadCount },
  });

  return attachBody({ message, body: t({ key: 'webPush.testBody', locale }) });
};
