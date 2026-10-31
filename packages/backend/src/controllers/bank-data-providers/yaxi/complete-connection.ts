import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { logger } from '@js/utils/logger';
import { bankProviderRegistry } from '@services/bank-data-providers';
import { queueConnectionSync } from '@services/bank-data-providers/sync/sync-manager';
import type { YaxiProvider } from '@services/bank-data-providers/yaxi';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ connectionId: recordId() }),
    body: z.object({
      resultJwt: z.string().min(1).max(65_536),
      connectionData: z.base64().min(1).max(65_536),
      bankConnectionId: z.string().min(1).max(255),
      bankName: z.string().min(1).max(255),
      logoId: z.string().max(255).nullish(),
    }),
  }),
  async ({ user, params, body }) => {
    const { connectionId } = params;
    const provider = bankProviderRegistry.get(BANK_PROVIDER_TYPE.YAXI) as YaxiProvider;

    await provider.completeConnection({ connectionId, userId: user.id, ...body });

    // The connection is already active at this point, so a failed enqueue must not fail the request.
    try {
      await queueConnectionSync({ userId: user.id, connectionId });
    } catch (error) {
      logger.error(
        { message: `[YAXI] Failed to queue sync after completing connection ${connectionId}`, error: error as Error },
        { userId: user.id },
      );
    }

    return { data: { connectionId } };
  },
);
