import { createController } from '@controllers/helpers/controller-factory';
import * as payeesService from '@services/payees';
import { z } from 'zod';

import { addIgnoredNameBodySchema } from './shared-schemas';

const schema = z.object({
  body: addIgnoredNameBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const row = await payeesService.addPayeeIgnoredName({
    userId: user.id,
    rawName: body.rawName,
    force: body.force,
  });
  return {
    data: {
      id: row.id,
      normalizedName: row.normalizedName,
      rawSample: row.rawSample,
      createdAt: row.createdAt.toISOString(),
    },
  };
});
