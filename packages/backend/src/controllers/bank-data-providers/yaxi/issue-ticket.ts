import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { bankProviderRegistry } from '@services/bank-data-providers';
import type { YaxiProvider } from '@services/bank-data-providers/yaxi';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ connectionId: recordId() }),
  }),
  async ({ user, params }) => {
    const provider = bankProviderRegistry.get(BANK_PROVIDER_TYPE.YAXI) as YaxiProvider;
    const data = await provider.issueBrowserTicket({ connectionId: params.connectionId, userId: user.id });

    return { data };
  },
);
