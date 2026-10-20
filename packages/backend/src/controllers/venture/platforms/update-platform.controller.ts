import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeVenturePlatform } from '@root/serializers';
import { updateVenturePlatform } from '@services/venture/platforms/update.service';
import { z } from 'zod';

import { updateVenturePlatformBodySchema } from '../schemas';

export default createController(
  z.object({
    params: z.object({ id: recordId() }),
    body: updateVenturePlatformBodySchema,
  }),
  async ({ user, params, body }) => {
    const platform = await updateVenturePlatform({
      userId: user.id,
      platformId: params.id,
      ...body,
    });
    return { data: serializeVenturePlatform(platform) };
  },
);
