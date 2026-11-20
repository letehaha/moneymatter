import { createController } from '@controllers/helpers/controller-factory';
import { syncAllUserAccounts } from '@root/services/bank-data-providers/sync/sync-manager';
import { z } from 'zod';

export default createController(z.object({}), async ({ user }) => {
  const result = await syncAllUserAccounts(user.id);

  return {
    data: result,
  };
});
