import { CATEGORIZATION_MODE } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFields } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { locationSchema } from '@controllers/transactions.controller/schemas';
import * as payeesService from '@services/payees';
import { z } from 'zod';

import { serializePayee } from './serializer';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      defaultCategoryId: recordId().nullable().optional(),
      categorizationMode: z.nativeEnum(CATEGORIZATION_MODE).optional(),
      defaultTagIds: z.array(recordId()).optional(),
      defaultLocation: locationSchema.nullable().optional(),
      // Absent key → no change; a key that changes the stored value stamps
      // logoSource 'manual'; a null that clears nothing writes nothing.
      ...logoFieldsShape,
    })
    .superRefine((data, ctx) => refineLogoFields({ data, ctx })),
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
