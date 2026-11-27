import { DEVICE_TOKEN_ENVIRONMENTS } from '@bt/shared/types';
import { EnvVar, isEnvConfigured } from '@common/utils/env';
import { createController } from '@controllers/helpers/controller-factory';
import { registerDeviceToken, unregisterDeviceToken } from '@services/notifications/device-tokens';
import { z } from 'zod';

// Hex only: the token goes into the APNs request path.
const token = z
  .string()
  .regex(/^[0-9a-fA-F]{32,200}$/)
  .transform((value) => value.toLowerCase());

// Read per request: the topic of every push is a client-sent bundle id, so only the server's own app is accepted.
const isAllowedBundleId = (value: string) => {
  const allowed = process.env[EnvVar.APPLE_APP_BUNDLE_IDENTIFIER];
  return isEnvConfigured(EnvVar.APPLE_APP_BUNDLE_IDENTIFIER, allowed) && value === allowed;
};

export const registerDeviceTokenController = createController(
  z.object({
    body: z.strictObject({
      token,
      environment: z.enum(Object.values(DEVICE_TOKEN_ENVIRONMENTS)),
      bundleId: z.string().refine(isAllowedBundleId, { message: 'Unknown bundle id' }),
    }),
  }),
  async ({ user, body }) => {
    await registerDeviceToken({ userId: user.id, ...body });
  },
);

export const unregisterDeviceTokenController = createController(
  z.object({ params: z.object({ token }) }),
  async ({ user, params }) => {
    await unregisterDeviceToken({ userId: user.id, token: params.token });
  },
);
