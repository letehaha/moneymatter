/**
 * Vehicle Serializers
 *
 * Vehicle responses include the underlying Account inline so the frontend has
 * one round-trip to render a vehicle card / detail (name, currency, current
 * value all come from Accounts; metadata + depreciation params come from
 * Vehicles).
 */
import { DEPRECIATION_PRESET, type RecordId, VEHICLE_CLASS } from '@bt/shared/types';
import { moneyToApiDecimal, moneyToApiDecimalOrNull } from '@common/types/money';
import type Vehicles from '@models/vehicles.model';
import { serializeAccount, type AccountApiResponse } from '@root/serializers/accounts.serializer';

export interface VehicleApiResponse {
  id: string;
  accountId: RecordId;
  userId: number;
  make: string;
  model: string;
  trim: string | null;
  year: number;
  vehicleClass: VEHICLE_CLASS;
  purchasePrice: number;
  purchaseDate: string;
  valueAnchor: number | null;
  valueAnchorDate: string | null;
  depreciationPreset: DEPRECIATION_PRESET;
  customAnnualRatePct: number | null;
  salvageFloorPct: number;
  currentMileage: number | null;
  valueLastComputedAt: string | null;
  createdAt: string;
  updatedAt: string;
  account: AccountApiResponse | null;
}

export function serializeVehicle(vehicle: Vehicles): VehicleApiResponse {
  return {
    id: vehicle.id,
    accountId: vehicle.accountId,
    userId: vehicle.userId,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    year: vehicle.year,
    vehicleClass: vehicle.vehicleClass,
    purchasePrice: moneyToApiDecimal(vehicle.purchasePrice),
    purchaseDate: vehicle.purchaseDate,
    valueAnchor: moneyToApiDecimalOrNull(vehicle.valueAnchor),
    valueAnchorDate: vehicle.valueAnchorDate,
    depreciationPreset: vehicle.depreciationPreset,
    customAnnualRatePct: vehicle.customAnnualRatePct ? Number(vehicle.customAnnualRatePct) : null,
    salvageFloorPct: Number(vehicle.salvageFloorPct),
    currentMileage: vehicle.currentMileage,
    valueLastComputedAt: vehicle.valueLastComputedAt ? vehicle.valueLastComputedAt.toISOString() : null,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
    account: vehicle.account ? serializeAccount(vehicle.account) : null,
  };
}

export function serializeVehicles(vehicles: Vehicles[]): VehicleApiResponse[] {
  return vehicles.map(serializeVehicle);
}
