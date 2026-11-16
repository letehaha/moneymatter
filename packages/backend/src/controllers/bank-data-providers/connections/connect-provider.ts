import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { connectProvider } from '@root/services/bank-data-providers/connection/connect-provider';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      providerType: z.enum(BANK_PROVIDER_TYPE),
    }),
    body: z.object({
      credentials: z.record(z.string(), z.unknown()),
      providerName: z.string().optional(),
    }),
  }),
  async ({ user, params, body }) => {
    const data = await connectProvider({
      providerType: params.providerType,
      userId: user.id,
      credentials: body.credentials,
      providerName: body.providerName,
    });

    return {
      data,
    };
  },
);
