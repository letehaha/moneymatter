import { createController } from '@controllers/helpers/controller-factory';
import * as payeesService from '@services/payees';
import { z } from 'zod';

import { bulkDeletePayeesBodySchema } from './shared-schemas';

const schema = z.object({
  body: bulkDeletePayeesBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const data = await payeesService.bulkDeletePayees({
    userId: user.id,
    ids: body.ids,
    ignoreFuture: body.ignoreFuture,
  });
  return { data };
});
