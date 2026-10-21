import type {
  PushConfigResponse,
  PushDeviceDto,
  SubscribePushRequest,
  SyncPushSubscriptionResponse,
} from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError, ValidationError } from '@js/errors';
import PushSubscriptions from '@models/push-subscriptions.model';
import { withTransaction } from '@services/common/with-transaction';
import { createHash, randomUUID } from 'node:crypto';
import { QueryTypes, UniqueConstraintError } from 'sequelize';

import { getWebPushConfig } from './config';
import { sanitizeDeviceLabel } from './device-label';
import { isPushEndpointAllowed } from './endpoint-allowlist';

const P256DH_BYTES = 65;
const AUTH_SECRET_BYTES = 16;
const ENDPOINT_HASH_LENGTH = 16;
const MAX_USER_AGENT_LENGTH = 512;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** First 16 hex characters of SHA-256 over the endpoint: lets a client recognize its own device without the capability URL. */
const hashPushEndpoint = ({ endpoint }: { endpoint: string }): string =>
  createHash('sha256').update(endpoint).digest('hex').slice(0, ENDPOINT_HASH_LENGTH);

type DeviceRow = Pick<
  PushSubscriptions,
  'id' | 'endpoint' | 'deviceLabel' | 'createdAt' | 'lastSeenAt' | 'lastSuccessAt' | 'lastFailureAt' | 'failureCount'
>;

const toDeviceDto = ({ row }: { row: DeviceRow }): PushDeviceDto => ({
  id: row.id,
  deviceLabel: row.deviceLabel,
  endpointHost: new URL(row.endpoint).host,
  endpointHash: hashPushEndpoint({ endpoint: row.endpoint }),
  createdAt: row.createdAt.toISOString(),
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
  lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
  failureCount: row.failureCount,
});

/** A `PushSubscriptions` row as Postgres returns it from the upsert, plus whether this call inserted it. */
type UpsertedRow = DeviceRow & { inserted: boolean };

const hasDecodedLength = ({ value, bytes }: { value: string; bytes: number }): boolean =>
  BASE64URL_PATTERN.test(value) && Buffer.from(value, 'base64url').length === bytes;

interface NormalizedSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: Date | null;
  deviceLabel: string | null;
  userAgent: string | null;
}

/**
 * Throws unless Web Push is configured and the request carries an endpoint the backend may call
 * and keys of the right size, then returns the fields the row stores.
 */
const validateSubscription = ({
  subscription,
  userAgent,
}: {
  subscription: SubscribePushRequest;
  userAgent: string | null | undefined;
}): NormalizedSubscription => {
  requirePushConfig();

  if (!isPushEndpointAllowed({ endpoint: subscription.endpoint })) {
    throw new ValidationError({ message: t({ key: 'webPush.endpointNotAllowed' }) });
  }

  const { p256dh, auth } = subscription.keys;
  if (
    !hasDecodedLength({ value: p256dh, bytes: P256DH_BYTES }) ||
    !hasDecodedLength({ value: auth, bytes: AUTH_SECRET_BYTES })
  ) {
    throw new ValidationError({ message: t({ key: 'webPush.invalidKeys' }) });
  }

  return {
    endpoint: subscription.endpoint,
    p256dh,
    auth,
    expirationTime:
      subscription.expirationTime === null || subscription.expirationTime === undefined
        ? null
        : new Date(subscription.expirationTime),
    deviceLabel: sanitizeDeviceLabel({ label: subscription.deviceLabel }),
    userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
  };
};

const requirePushConfig = () => {
  const config = getWebPushConfig();
  if (!config) throw new NotFoundError({ message: t({ key: 'webPush.notConfigured' }) });
  return config;
};

const subscriptionNotFound = () => new NotFoundError({ message: t({ key: 'webPush.subscriptionNotFound' }) });

export const getPushConfig = (): PushConfigResponse => {
  const config = getWebPushConfig();
  return { enabled: Boolean(config), vapidPublicKey: config?.publicKey ?? null };
};

const upsertPushSubscriptionImpl = async ({
  userId,
  subscription,
  userAgent,
}: {
  userId: number;
  subscription: SubscribePushRequest;
  userAgent?: string | null;
}): Promise<{ device: PushDeviceDto; created: boolean }> => {
  const config = requirePushConfig();
  const fields = validateSubscription({ subscription, userAgent });
  const now = new Date();

  // The endpoint is the conflict target: holding it proves possession of the browser, so an
  // existing row, whoever owns it, moves to the caller under the same id.
  const [row] = await PushSubscriptions.sequelize!.query<UpsertedRow>(
    `INSERT INTO "PushSubscriptions"
       ("id", "userId", "endpoint", "p256dh", "auth", "vapidKeyId", "expirationTime", "userAgent",
        "deviceLabel", "lastSeenAt", "failureCount", "createdAt", "updatedAt")
     VALUES
       (:id, :userId, :endpoint, :p256dh, :auth, :vapidKeyId, :expirationTime, :userAgent,
        :deviceLabel, :now, 0, :now, :now)
     ON CONFLICT ("endpoint") DO UPDATE SET
       "userId" = EXCLUDED."userId",
       "p256dh" = EXCLUDED."p256dh",
       "auth" = EXCLUDED."auth",
       "vapidKeyId" = EXCLUDED."vapidKeyId",
       "expirationTime" = EXCLUDED."expirationTime",
       "userAgent" = EXCLUDED."userAgent",
       "deviceLabel" = EXCLUDED."deviceLabel",
       "lastSeenAt" = EXCLUDED."lastSeenAt",
       "failureCount" = 0,
       "lastFailureAt" = NULL,
       "lastFailureStatus" = NULL,
       "updatedAt" = EXCLUDED."updatedAt"
     RETURNING *, (xmax = 0) AS "inserted"`,
    {
      type: QueryTypes.SELECT,
      replacements: { id: randomUUID(), userId, vapidKeyId: config.keyId, now, ...fields },
    },
  );

  return {
    device: toDeviceDto({ row: row! }),
    created: row!.inserted,
  };
};

/** Enable: registers the browser for the caller, taking the row over from any other account. */
const upsertPushSubscription = withTransaction(upsertPushSubscriptionImpl);

const rotatePushSubscriptionImpl = async ({
  userId,
  subscription,
  oldEndpoint,
  userAgent,
}: {
  userId: number;
  subscription: SubscribePushRequest;
  oldEndpoint: string;
  userAgent?: string | null;
}): Promise<{ device: PushDeviceDto; created: boolean }> => {
  const config = requirePushConfig();
  const fields = validateSubscription({ subscription, userAgent });
  const now = new Date();

  const refresh = {
    p256dh: fields.p256dh,
    auth: fields.auth,
    expirationTime: fields.expirationTime,
    vapidKeyId: config.keyId,
    lastSeenAt: now,
  };
  // A rotation request from the service worker carries no label or user agent: keep what is stored.
  const optionalFields = {
    ...(fields.deviceLabel !== null && { deviceLabel: fields.deviceLabel }),
    ...(fields.userAgent !== null && { userAgent: fields.userAgent }),
  };

  const oldRow = await PushSubscriptions.findOne({ where: { endpoint: oldEndpoint, userId }, lock: true });

  if (!oldRow) {
    // The rotation may have happened already (the worker's request ran first): then the caller
    // owns the new endpoint and there is nothing to enrol, move or create.
    const owned = await PushSubscriptions.findOne({ where: { endpoint: fields.endpoint, userId }, lock: true });
    if (!owned) throw subscriptionNotFound();

    await owned.update({ ...refresh, ...optionalFields });
    return { device: toDeviceDto({ row: owned }), created: false };
  }

  const target = await PushSubscriptions.findOne({ where: { endpoint: fields.endpoint }, lock: true });
  if (target && target.id !== oldRow.id) {
    // Taking an endpoint over from another account is reserved for Enable.
    if (target.userId !== userId) {
      throw new ConflictError({ message: t({ key: 'webPush.endpointInUse' }) });
    }
    await target.destroy();
  }

  await oldRow.update({ endpoint: fields.endpoint, ...refresh, ...optionalFields, failureCount: 0 });
  return { device: toDeviceDto({ row: oldRow }), created: false };
};

const rotatePushSubscriptionTransactional = withTransaction(rotatePushSubscriptionImpl);

/**
 * Rotate: the browser replaced a subscription. Only ever updates a row the caller already owns,
 * so it can never enrol a device or an account.
 */
const rotatePushSubscription = async (
  params: Parameters<typeof rotatePushSubscriptionImpl>[0],
): ReturnType<typeof rotatePushSubscriptionImpl> => {
  try {
    return await rotatePushSubscriptionTransactional(params);
  } catch (error) {
    // Another account enabled the new endpoint between the lookup and the update.
    if (error instanceof UniqueConstraintError) {
      throw new ConflictError({ message: t({ key: 'webPush.endpointInUse' }) });
    }
    throw error;
  }
};

/** Entry point of `POST /subscriptions`: Enable without `oldEndpoint`, Rotate with it. */
export const subscribePushDevice = ({
  userId,
  subscription,
  userAgent,
}: {
  userId: number;
  subscription: SubscribePushRequest;
  userAgent?: string | null;
}) =>
  subscription.oldEndpoint
    ? rotatePushSubscription({ userId, subscription, oldEndpoint: subscription.oldEndpoint, userAgent })
    : upsertPushSubscription({ userId, subscription, userAgent });

const syncPushSubscriptionImpl = async ({
  userId,
  endpoint,
}: {
  userId: number;
  endpoint: string;
}): Promise<SyncPushSubscriptionResponse> => {
  requirePushConfig();

  const row = await PushSubscriptions.findOne({ where: { endpoint }, lock: true });
  if (!row) return { known: false };

  // The browser is signed in as someone else now: its old owner must stop receiving pushes on it.
  // Sync never inserts, so a user who never opted in on a shared browser stays unsubscribed.
  if (row.userId !== userId) {
    await row.destroy();
    return { known: false };
  }

  await row.update({ lastSeenAt: new Date() });
  return { known: true };
};

export const syncPushSubscription = withTransaction(syncPushSubscriptionImpl);

export const listPushSubscriptions = async ({ userId }: { userId: number }): Promise<PushDeviceDto[]> => {
  const rows = await PushSubscriptions.findAll({ where: { userId }, order: [['createdAt', 'ASC']] });
  return rows.map((row) => toDeviceDto({ row }));
};

const deletePushSubscriptionImpl = async ({ userId, id }: { userId: number; id: string }): Promise<void> => {
  const row = await findOrThrowNotFound({
    query: PushSubscriptions.findOne({ where: { id, userId } }),
    message: t({ key: 'webPush.subscriptionNotFound' }),
  });
  await row.destroy();
};

export const deletePushSubscription = withTransaction(deletePushSubscriptionImpl);

const unsubscribePushEndpointImpl = async ({
  userId,
  endpoint,
}: {
  userId: number;
  endpoint: string;
}): Promise<void> => {
  await PushSubscriptions.destroy({ where: { endpoint, userId } });
};

/** Removes the caller's row for an endpoint; idempotent. */
export const unsubscribePushEndpoint = withTransaction(unsubscribePushEndpointImpl);
