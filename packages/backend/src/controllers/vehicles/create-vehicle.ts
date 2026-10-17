import { DEPRECIATION_PRESET, VEHICLE_CLASS } from '@bt/shared/types';
import { decimalMoney, isoCurrencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeVehicle } from '@root/serializers/vehicles.serializer';
import { createVehicle } from '@services/vehicles/create-vehicle.service';
import { z } from 'zod';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  body: z.object({
    name: z.string().min(1).max(200).trim(),
    currencyCode: isoCurrencyCode(),
    make: z.string().min(1).max(100).trim(),
    model: z.string().min(1).max(100).trim(),
    trim: z.string().max(100).nullable().optional(),
    year: z
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 1),
    vehicleClass: z.nativeEnum(VEHICLE_CLASS),
    purchasePrice: decimalMoney().refine((m) => m.isPositive(), { message: 'purchasePrice must be > 0' }),
    purchaseDate: z.string().regex(datePattern, 'purchaseDate must be YYYY-MM-DD'),
    depreciationPreset: z.nativeEnum(DEPRECIATION_PRESET).optional(),
    customAnnualRatePct: z.number().min(0).max(100).nullable().optional(),
    salvageFloorPct: z.number().min(0).max(100).optional(),
    currentMileage: z.number().int().min(0).nullable().optional(),
  }),
});

export default createController(schema, async ({ user, body }) => {
  const vehicle = await createVehicle({
    userId: user.id,
    ...body,
  });

  return {
    data: vehicle ? serializeVehicle(vehicle) : null,
    statusCode: 201,
  };
});
