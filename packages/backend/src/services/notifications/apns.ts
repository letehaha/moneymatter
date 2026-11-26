import {
  type DeviceTokenEnvironment,
  NOTIFICATION_TYPES,
  type NotificationModel,
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
}: {
  environment: DeviceTokenEnvironment;
  devices: DeviceTokens[];
  body: string;
  providerToken: string;
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
      if (result.status === 'rejected') {
        logger.error({ message: 'APNs push failed', error: result.reason as Error });
      } else if (isDeadToken(result.value)) {
        dead.push({ device: devices[index]!, reason: result.value.reason });
      } else if (result.value.status !== 200) {
        // A rejected provider token (expired, clock skew) is re-signed on the next push.
        if (result.value.status === 403) cachedJwt = null;
        logger.error(`APNs push rejected: ${result.value.status} ${result.value.reason ?? ''}`);
      }
    });
    if (dead.length) {
      // BadDeviceToken also means a token registered under the wrong environment.
      logger.warn('APNs dead device tokens removed', { environment, reasons: dead.map(({ reason }) => reason) });
      await DeviceTokens.destroy({ where: { id: dead.map(({ device }) => device.id) } });
    }
  } finally {
    session.close();
  }
};

/** Best-effort: never throws, so a push can't fail what triggered it. */
export const sendNotificationPush = async ({ notification }: { notification: NotificationModel }) => {
  try {
    const devices = await DeviceTokens.findAll({ where: { userId: notification.userId } });
    if (!devices.length) return;

    const isWatchlistAlert = notification.type === NOTIFICATION_TYPES.watchlistAlert;
    const payload = (isWatchlistAlert ? notification.payload : {}) as Partial<WatchlistAlertNotificationPayload>;
    const { portfolioId } = payload;
    const body = JSON.stringify({
      aps: {
        alert: { title: notification.title, ...(notification.message && { body: notification.message }) },
        sound: 'default',
        'thread-id': portfolioId ?? notification.type,
        // Lets the iOS Notification Service Extension attach the security's logo; the category picks its content extension.
        ...(isWatchlistAlert && { 'mutable-content': 1, category: 'WATCHLIST_ALERT' }),
      },
      notificationId: notification.id,
      type: notification.type,
      ...(portfolioId && { portfolioId }),
      ...(isWatchlistAlert && {
        securityId: payload.securityId,
        symbol: payload.symbol ?? undefined,
        assetClass: payload.assetClass,
        logoUrl: payload.logoUrl?.startsWith('https://') ? payload.logoUrl : undefined,
        securityName: payload.securityName ?? undefined,
        portfolioName: payload.portfolioName,
        close: payload.close,
        previousClose: payload.previousClose ?? undefined,
        changePercent: payload.changePercent ?? undefined,
        currencyCode: payload.currencyCode,
        closeDate: payload.closeDate,
      }),
    });

    // Signed before connecting, so an unusable key fails once per push rather than once per device.
    const providerToken = getProviderToken();
    await Promise.all(
      [...Map.groupBy(devices, (device) => device.environment)].map(([environment, envDevices]) =>
        sendToEnvironment({ environment, devices: envDevices, body, providerToken }),
      ),
    );
  } catch (error) {
    logger.error(
      { message: 'APNs push failed', error: error as Error },
      { notificationId: notification.id, userId: notification.userId },
    );
  }
};
