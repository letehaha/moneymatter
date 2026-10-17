import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTrackerStats } from '@root/serializers';
import { getTrackerStats } from '@root/services/trackers/stats';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
  }),
  async ({ user, params }) => {
    const { stats, decimals } = await getTrackerStats({ userId: user.id, trackerId: params.id });

    return { data: serializeTrackerStats({ stats, decimals }) };
  },
);
