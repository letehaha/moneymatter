import { createController } from '@controllers/helpers/controller-factory';
import { serializeVenturePlatform } from '@root/serializers';
import { createVenturePlatform } from '@services/venture/platforms/create.service';
import { z } from 'zod';

import { createVenturePlatformBodyShape } from '../schemas';

export default createController(
  z.object({
    body: z.object(createVenturePlatformBodyShape),
  }),
  async ({ user, body }) => {
    const platform = await createVenturePlatform({
      userId: user.id,
      ...body,
    });
    return { data: serializeVenturePlatform(platform) };
  },
);
