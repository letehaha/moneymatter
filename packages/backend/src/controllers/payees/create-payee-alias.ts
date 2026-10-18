import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as payeesService from '@services/payees';
import { z } from 'zod';

import { serializePayee } from './serializer';
import { createPayeeAliasBodySchema } from './shared-schemas';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: createPayeeAliasBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const payee = await payeesService.createPayeeAlias({
    userId: user.id,
    payeeId: params.id,
    rawName: body.rawName,
  });
  return { data: serializePayee(payee), statusCode: 201 };
});
