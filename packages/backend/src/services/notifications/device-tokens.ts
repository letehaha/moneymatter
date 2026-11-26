import type { RegisterDeviceTokenBody } from '@bt/shared/types';
import DeviceTokens from '@models/device-tokens.model';
import { withTransaction } from '@services/common/with-transaction';

/** A token registered by another user moves to this one: a device gets one token, and the last sign-in owns it. */
export const registerDeviceToken = withTransaction(
  async ({ userId, ...fields }: { userId: number } & RegisterDeviceTokenBody): Promise<void> => {
    await DeviceTokens.upsert({ userId, ...fields }, { conflictFields: ['token'] });
  },
);

export const unregisterDeviceToken = withTransaction(
  async ({ userId, token }: { userId: number; token: string }): Promise<void> => {
    await DeviceTokens.destroy({ where: { userId, token } });
  },
);
