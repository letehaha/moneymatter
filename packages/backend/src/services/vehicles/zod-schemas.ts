import { DEPRECIATION_PRESET, VEHICLE_CLASS } from '@bt/shared/types';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { z } from 'zod';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Create body of `POST /vehicles`. The purchase price is a plain decimal in the field shape, which
 * the MCP tool exposes as its input; the body schema below turns it into `Money`.
 */
export const createVehicleBodyFields = {
  name: z.string().min(1).max(200).trim(),
  currencyCode: currencyCode(),
  make: z.string().min(1).max(100).trim(),
  model: z.string().min(1).max(100).trim(),
  trim: z.string().max(100).nullable().optional(),
  year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1),
  vehicleClass: z.nativeEnum(VEHICLE_CLASS),
  purchasePrice: z.number().positive({ message: 'purchasePrice must be > 0' }),
  purchaseDate: z.string().regex(datePattern, 'purchaseDate must be YYYY-MM-DD'),
  depreciationPreset: z.nativeEnum(DEPRECIATION_PRESET).optional(),
  customAnnualRatePct: z.number().min(0).max(100).nullable().optional(),
  salvageFloorPct: z.number().min(0).max(100).optional(),
  currentMileage: z.number().int().min(0).nullable().optional(),
};

export const createVehicleBodySchema = z
  .object(createVehicleBodyFields)
  .transform((body) => ({ ...body, purchasePrice: Money.fromDecimal(body.purchasePrice) }));

/**
 * Patch body of `PATCH /vehicles/:id`. The purchase price, purchase date and currency are
 * absent on purpose: the depreciation curve and the account are anchored to them.
 */
export const updateVehicleBodyFields = {
  name: z.string().min(1).max(200).trim().optional(),
  make: z.string().min(1).max(100).trim().optional(),
  model: z.string().min(1).max(100).trim().optional(),
  trim: z.string().max(100).nullable().optional(),
  year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1)
    .optional(),
  vehicleClass: z.nativeEnum(VEHICLE_CLASS).optional(),
  depreciationPreset: z.nativeEnum(DEPRECIATION_PRESET).optional(),
  customAnnualRatePct: z.number().min(0).max(100).nullable().optional(),
  salvageFloorPct: z.number().min(0).max(100).optional(),
  currentMileage: z.number().int().min(0).nullable().optional(),
};

export const updateVehicleBodySchema = z.object(updateVehicleBodyFields);

export const vehicleIdParamsSchema = z.object({ id: recordId() });
