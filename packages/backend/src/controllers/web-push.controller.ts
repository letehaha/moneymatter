import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { sendTestPush } from '@services/web-push/send-test-push';
import * as subscriptionsService from '@services/web-push/subscriptions.service';
import { z } from 'zod';

const MAX_ENDPOINT_LENGTH = 2048;
const MAX_DEVICE_LABEL_LENGTH = 100;

const endpointSchema = z.string().min(1).max(MAX_ENDPOINT_LENGTH);

const subscribeSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(128),
    auth: z.string().min(1).max(64),
  }),
  expirationTime: z.number().nullable().optional(),
  deviceLabel: z.string().max(MAX_DEVICE_LABEL_LENGTH).nullable().optional(),
  oldEndpoint: endpointSchema.optional(),
});

export const getPushConfig = createController(z.object({}), async () => ({
  data: subscriptionsService.getPushConfig(),
}));

export const subscribePush = createController(z.object({ body: subscribeSchema }), async ({ user, body, req }) => {
  const { device, created } = await subscriptionsService.subscribePushDevice({
    userId: user.id,
    subscription: body,
    userAgent: req.get('user-agent'),
  });

  return { data: device, statusCode: created ? 201 : 200 };
});

export const syncPushSubscription = createController(
  z.object({ body: z.object({ endpoint: endpointSchema }) }),
  async ({ user, body }) => ({
    data: await subscriptionsService.syncPushSubscription({ userId: user.id, endpoint: body.endpoint }),
  }),
);

export const listPushSubscriptions = createController(z.object({}), async ({ user }) => ({
  data: await subscriptionsService.listPushSubscriptions({ userId: user.id }),
}));

export const deletePushSubscription = createController(
  z.object({ params: z.object({ id: recordId() }) }),
  async ({ user, params }) => {
    await subscriptionsService.deletePushSubscription({ userId: user.id, id: params.id });
  },
);

export const unsubscribePush = createController(
  z.object({ body: z.object({ endpoint: endpointSchema }) }),
  async ({ user, body }) => {
    await subscriptionsService.unsubscribePushEndpoint({ userId: user.id, endpoint: body.endpoint });
  },
);

export const sendTestPushNotification = createController(z.object({}), async ({ user }) => ({
  data: await sendTestPush({ userId: user.id }),
}));
