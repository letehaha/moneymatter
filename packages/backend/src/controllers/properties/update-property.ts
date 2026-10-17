import { MAX_ANNUAL_APPRECIATION_RATE_PCT, MIN_ANNUAL_APPRECIATION_RATE_PCT, PROPERTY_TYPE } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeProperty } from '@root/serializers/properties.serializer';
import { updateProperty } from '@services/properties/update-property.service';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
  body: z.object({
    name: z.string().min(1).max(200).trim().optional(),
    address: z.string().min(1).max(500).trim().optional(),
    city: z.string().max(120).trim().nullable().optional(),
    country: z.string().max(120).trim().nullable().optional(),
    propertyType: z.nativeEnum(PROPERTY_TYPE).optional(),
    yearBuilt: z
      .number()
      .int()
      .min(1000)
      .max(new Date().getFullYear() + 5)
      .nullable()
      .optional(),
    notes: z.string().max(2000).nullable().optional(),
    annualAppreciationRatePct: z
      .number()
      .min(MIN_ANNUAL_APPRECIATION_RATE_PCT)
      .max(MAX_ANNUAL_APPRECIATION_RATE_PCT)
      .optional(),
    loanAccountId: recordId().nullable().optional(),
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  const property = await updateProperty({
    userId: user.id,
    propertyId: params.id,
    ...body,
  });
  return { data: property ? serializeProperty(property) : null };
});
