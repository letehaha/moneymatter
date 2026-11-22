import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTrackerSpendingStats } from '@root/serializers';
import { getTrackerSpendingStats } from '@root/services/trackers/spending-stats';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
  }),
  async ({ user, params }) => {
    return {
      data: serializeTrackerSpendingStats(await getTrackerSpendingStats({ userId: user.id, trackerId: params.id })),
    };
  },
);
