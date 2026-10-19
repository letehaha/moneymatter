import { CATEGORIZATION_MODE } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFields } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { locationSchema } from '@controllers/transactions.controller/schemas';
import * as payeesService from '@services/payees';
import { z } from 'zod';

import { serializePayee } from './serializer';

const schema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters'),
      defaultCategoryId: recordId().nullable().optional(),
      categorizationMode: z.nativeEnum(CATEGORIZATION_MODE).optional(),
      defaultTagIds: z.array(recordId()).optional(),
      defaultLocation: locationSchema.nullable().optional(),
      // A key that sets a value stamps logoSource 'manual' on the new Payee;
      // absent keys leave the logo unset for the background resolver to fill in.
      ...logoFieldsShape,
    })
    .superRefine((data, ctx) => refineLogoFields({ data, ctx })),
});

export default createController(schema, async ({ user, body }) => {
  const payee = await payeesService.createPayee({
    userId: user.id,
    name: body.name,
    defaultCategoryId: body.defaultCategoryId ?? null,
    categorizationMode: body.categorizationMode,
    defaultTagIds: body.defaultTagIds,
    defaultLocation: body.defaultLocation,
    logoDomain: body.logoDomain,
    logoInitials: body.logoInitials,
    logoColor: body.logoColor,
    logoIcon: body.logoIcon,
  });
  return { data: serializePayee(payee), statusCode: 201 };
});
