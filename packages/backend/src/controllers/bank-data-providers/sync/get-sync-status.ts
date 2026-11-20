import { createController } from '@controllers/helpers/controller-factory';
import { getUserAccountsSyncStatus } from '@root/services/bank-data-providers/sync/get-user-sync-status';
import { z } from 'zod';

export default createController(z.object({}), async ({ user }) => {
  const status = await getUserAccountsSyncStatus(user.id);

  return {
    data: status,
  };
});
