import { MAX_ANNUAL_APPRECIATION_RATE_PCT, MIN_ANNUAL_APPRECIATION_RATE_PCT, PROPERTY_TYPE } from '@bt/shared/types';
import { currencyCode, decimalMoney, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeProperty } from '@root/serializers/properties.serializer';
import { createProperty } from '@services/properties/create-property.service';
import { z } from 'zod';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  body: z.object({
    name: z.string().min(1).max(200).trim(),
    currencyCode: currencyCode(),
    address: z.string().min(1).max(500).trim(),
    city: z.string().max(120).trim().nullable().optional(),
    country: z.string().max(120).trim().nullable().optional(),
    propertyType: z.nativeEnum(PROPERTY_TYPE),
    yearBuilt: z
      .number()
      .int()
      .min(1000)
      .max(new Date().getFullYear() + 5)
      .nullable()
      .optional(),
    notes: z.string().max(2000).nullable().optional(),
    purchasePrice: decimalMoney().refine((m) => m.isPositive(), { message: 'purchasePrice must be > 0' }),
    purchaseDate: z.string().regex(datePattern, 'purchaseDate must be YYYY-MM-DD'),
    annualAppreciationRatePct: z
      .number()
      .min(MIN_ANNUAL_APPRECIATION_RATE_PCT)
      .max(MAX_ANNUAL_APPRECIATION_RATE_PCT)
      .optional(),
    loanAccountId: recordId().nullable().optional(),
  }),
});

export default createController(schema, async ({ user, body }) => {
  const property = await createProperty({
    userId: user.id,
    ...body,
  });

  return {
    data: property ? serializeProperty(property) : null,
    statusCode: 201,
  };
});
