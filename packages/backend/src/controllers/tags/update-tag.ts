import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as tagsService from '@services/tags';
import { z } from 'zod';

import { updateTagBodySchema } from './shared-schemas';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: updateTagBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const { name, color, icon, description } = body;

  const data = await tagsService.updateTag({
    id: params.id,
    userId: user.id,
    name,
    color,
    icon,
    description,
  });

  return { data };
});
