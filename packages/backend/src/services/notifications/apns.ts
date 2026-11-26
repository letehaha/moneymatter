import {
  type DeviceTokenEnvironment,
  NOTIFICATION_TYPES,
  type NotificationModel,
  type NotificationType,
  type ShareInvitationNotificationPayload,
  type SubscriptionReminderNotificationPayload,
  type UnrealizedLossAlertNotificationPayload,
  type WatchlistAlertNotificationPayload,
} from '@bt/shared/types';
import { EnvVar, isEnvConfigured } from '@common/utils/env';
import { signAppleJwt } from '@config/apple-client-secret';
import { logger } from '@js/utils/logger';
import DeviceTokens from '@models/device-tokens.model';
import http2 from 'node:http2';

const HOSTS: Record<DeviceTokenEnvironment, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

// Apple rejects provider tokens older than 60 minutes and throttles refreshes under 20.
const JWT_TTL_MS = 50 * 60 * 1000;
const TIMEOUT_MS = 10_000;
// A price alert is stale after a day; APNs drops it rather than delivering it late.
const EXPIRATION_SECONDS = 24 * 60 * 60;

// The Sign in with Apple key, which also has APNs enabled.
const APNS_ENV_VARS = [EnvVar.APPLE_KEY_ID, EnvVar.APPLE_PRIVATE_KEY, EnvVar.APPLE_TEAM_ID] as const;

export const isApnsConfigured = () => APNS_ENV_VARS.every((name) => isEnvConfigured(name, process.env[name]));

let cachedJwt: { value: string; issuedAt: number } | null = null;

const getProviderToken = () => {
  const now = Date.now();
  if (cachedJwt && now - cachedJwt.issuedAt < JWT_TTL_MS) return cachedJwt.value;

  const value = signAppleJwt({
    keyId: process.env.APPLE_KEY_ID!,
    privateKey: process.env.APPLE_PRIVATE_KEY!,
    claims: { iss: process.env.APPLE_TEAM_ID, iat: Math.floor(now / 1000) },
  });
  cachedJwt = { value, issuedAt: now };
  return value;
};

interface ApnsResponse {
  status: number;
  reason?: string;
}

const isDeadToken = ({ status, reason }: ApnsResponse) =>
  status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered';

const parseReason = (body: string): string | undefined => {
  try {
    return JSON.parse(body).reason;
  } catch {
    return undefined;
  }
};

const postToDevice = ({
  session,
  device,
  body,
  providerToken,
}: {
  session: http2.ClientHttp2Session;
  device: DeviceTokens;
  body: string;
  providerToken: string;
}) =>
  new Promise<ApnsResponse>((resolve, reject) => {
    const stream = session.request({
      ':method': 'POST',
      ':path': `/3/device/${device.token}`,
      authorization: `bearer ${providerToken}`,
      'apns-topic': device.bundleId,
      'apns-push-type': 'alert',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + EXPIRATION_SECONDS),
    });
    let status = 0;
    let responseBody = '';
    stream.setEncoding('utf8');
    stream.setTimeout(TIMEOUT_MS, () => {
      reject(new Error('APNs request timed out'));
      stream.close(http2.constants.NGHTTP2_CANCEL);
    });
    stream.on('response', (headers) => (status = Number(headers[':status'])));
    stream.on('data', (chunk: string) => (responseBody += chunk));
    stream.on('end', () => resolve({ status, reason: responseBody ? parseReason(responseBody) : undefined }));
    stream.on('error', reject);
    stream.on('close', () => reject(new Error('APNs stream closed without a response')));
    stream.end(body);
  });

/**
 * One connection per environment per call.
 * ponytail: fine at alert-cron volume; keep a long-lived session per host if pushes become frequent.
 */
const sendToEnvironment = async ({
  environment,
  devices,
  body,
  providerToken,
  notificationId,
}: {
  environment: DeviceTokenEnvironment;
  devices: DeviceTokens[];
  body: string;
  providerToken: string;
  notificationId: NotificationModel['id'];
}) => {
  const session = http2.connect(HOSTS[environment]);
  session.on('error', (error) => logger.error({ message: 'APNs connection failed', error }));
  session.setTimeout(TIMEOUT_MS, () => session.destroy());
  try {
    const results = await Promise.allSettled(
      devices.map((device) => postToDevice({ session, device, body, providerToken })),
    );
    const dead: { device: DeviceTokens; reason?: string }[] = [];
    results.forEach((result, index) => {
      const context = { notificationId, environment, deviceTokenId: devices[index]!.id };
      if (result.status === 'rejected') {
        logger.error({ message: 'APNs push failed', error: result.reason as Error }, context);
      } else if (isDeadToken(result.value)) {
        dead.push({ device: devices[index]!, reason: result.value.reason });
      } else if (result.value.status !== 200) {
        // A rejected provider token (expired, clock skew) is re-signed on the next push.
        if (result.value.status === 403) cachedJwt = null;
        logger.error(`APNs push rejected: ${result.value.status} ${result.value.reason ?? ''}`, context);
      }
    });
    if (dead.length) {
      // BadDeviceToken also means a token registered under the wrong environment.
      logger.warn('APNs dead device tokens removed', {
        notificationId,
        environment,
        deviceTokenIds: dead.map(({ device }) => device.id),
        reasons: dead.map(({ reason }) => reason),
      });
      await DeviceTokens.destroy({ where: { id: dead.map(({ device }) => device.id) } });
    }
  } finally {
    session.close();
  }
};

// Each picks the iOS content extension that renders the long-press card.
const PUSH_CATEGORIES: Partial<Record<NotificationType, string>> = {
  [NOTIFICATION_TYPES.watchlistAlert]: 'WATCHLIST_ALERT',
  [NOTIFICATION_TYPES.unrealizedLossAlert]: 'UNREALIZED_LOSS_ALERT',
  [NOTIFICATION_TYPES.subscriptionReminder]: 'SUBSCRIPTION_REMINDER',
  [NOTIFICATION_TYPES.shareInvitationReceived]: 'INVITATION',
  [NOTIFICATION_TYPES.householdInvitationReceived]: 'INVITATION',
};

// Keeps a many-holding alert under the 4KB APNs payload limit.
const MAX_CARD_HOLDINGS = 5;

const httpsOnly = (url: string | null | undefined) => (url?.startsWith('https://') ? url : undefined);
const decimalString = (value: number | null | undefined) => (value == null ? undefined : String(value));

/** Top-level keys the app routes on and draws the card from. */
const cardFields = ({ type, payload }: NotificationModel): Record<string, unknown> => {
  switch (type) {
    case NOTIFICATION_TYPES.watchlistAlert: {
      const alert = payload as WatchlistAlertNotificationPayload;
      return {
        portfolioId: alert.portfolioId,
        securityId: alert.securityId,
        symbol: alert.symbol,
        assetClass: alert.assetClass,
        logoUrl: httpsOnly(alert.logoUrl),
        securityName: alert.securityName,
        portfolioName: alert.portfolioName,
        close: alert.close,
        previousClose: alert.previousClose,
        changePercent: alert.changePercent,
        currencyCode: alert.currencyCode,
        closeDate: alert.closeDate,
      };
    }
    case NOTIFICATION_TYPES.unrealizedLossAlert: {
      const alert = payload as UnrealizedLossAlertNotificationPayload;
      const { holdings } = alert;
      const [first] = holdings;
      const onePortfolio = first && holdings.every((holding) => holding.portfolioId === first.portfolioId);
      return {
        ...(onePortfolio && { portfolioId: first.portfolioId, portfolioName: first.portfolioName }),
        currencyCode: alert.currencyCode,
        percentThreshold: alert.percentThreshold,
        amountThreshold: decimalString(alert.amountThreshold),
        holdingsCount: holdings.length,
        holdings: holdings.slice(0, MAX_CARD_HOLDINGS).map((holding) => ({
          securityId: holding.securityId,
          symbol: holding.symbol,
          assetClass: holding.assetClass,
          logoUrl: httpsOnly(holding.logoUrl),
          portfolioId: holding.portfolioId,
          portfolioName: holding.portfolioName,
          lossPercent: holding.lossPercent,
          lossAmount: decimalString(holding.lossAmount),
        })),
      };
    }
    case NOTIFICATION_TYPES.subscriptionReminder: {
      const reminder = payload as SubscriptionReminderNotificationPayload;
      return {
        subscriptionId: reminder.subscriptionId,
        name: reminder.name,
        dueDate: reminder.dueDate,
        amount: decimalString(reminder.expectedAmount),
        currencyCode: reminder.currencyCode,
        baseAmount: decimalString(reminder.baseAmount),
        baseCurrencyCode: reminder.baseAmount == null ? undefined : reminder.baseCurrencyCode,
        frequency: reminder.frequency,
        intervalCount: reminder.intervalCount,
        intervalUnit: reminder.intervalUnit,
        categoryName: reminder.categoryName,
        accountName: reminder.accountName,
        logoDomain: reminder.logoDomain,
        logoInitials: reminder.logoInitials,
        logoColor: reminder.logoColor,
      };
    }
    case NOTIFICATION_TYPES.shareInvitationReceived:
    case NOTIFICATION_TYPES.householdInvitationReceived: {
      const invitation = payload as ShareInvitationNotificationPayload;
      return {
        invitationId: invitation.invitationId,
        token: invitation.token,
        resourceType: invitation.resourceType,
        resourceName: invitation.resourceName,
        permission: invitation.permission,
        ownerUsername: invitation.owner?.username,
        expiresAt: invitation.expiresAt,
      };
    }
    default:
      return {};
  }
};

/** Best-effort: never throws, so a push can't fail what triggered it. */
export const sendNotificationPush = async ({ notification }: { notification: NotificationModel }) => {
  try {
    const devices = await DeviceTokens.findAll({ where: { userId: notification.userId } });
    if (!devices.length) return;

    const fields = cardFields(notification);
    const category = PUSH_CATEGORIES[notification.type];
    const body = JSON.stringify(
      {
        aps: {
          alert: { title: notification.title, ...(notification.message && { body: notification.message }) },
          sound: 'default',
          'thread-id': fields.portfolioId ?? notification.type,
          // Lets the iOS Notification Service Extension attach a logo; the category picks the content extension.
          ...(category && { 'mutable-content': 1, category }),
        },
        notificationId: notification.id,
        type: notification.type,
        ...fields,
      },
      // The app treats a missing key as absent, so nulls are left out rather than sent.
      (_key, value) => value ?? undefined,
    );

    // Signed before connecting, so an unusable key fails once per push rather than once per device.
    const providerToken = getProviderToken();
    await Promise.all(
      [...Map.groupBy(devices, (device) => device.environment)].map(([environment, envDevices]) =>
        sendToEnvironment({ environment, devices: envDevices, body, providerToken, notificationId: notification.id }),
      ),
    );
  } catch (error) {
    logger.error(
      { message: 'APNs push failed', error: error as Error },
      { notificationId: notification.id, userId: notification.userId },
    );
  }
};
