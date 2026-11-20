import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as payeesService from '@services/payees';
import { z } from 'zod';

import { serializePayee } from './serializer';
import { updatePayeeBodySchema } from './shared-schemas';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: updatePayeeBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const payee = await payeesService.updatePayee({
    userId: user.id,
    id: params.id,
    name: body.name,
    defaultCategoryId: body.defaultCategoryId,
    categorizationMode: body.categorizationMode,
    defaultTagIds: body.defaultTagIds,
    defaultLocation: body.defaultLocation,
    // Pass undefined when the key was absent (Zod treats missing optional as
    // undefined), so the service can distinguish "set manual" from "leave alone".
    logoDomain: body.logoDomain,
    logoInitials: body.logoInitials,
    logoColor: body.logoColor,
    logoIcon: body.logoIcon,
  });
  return { data: serializePayee(payee) };
});
