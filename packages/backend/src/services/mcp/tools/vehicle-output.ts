import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import type Vehicles from '@models/vehicles.model';
import { serializeVehicle } from '@root/serializers/vehicles.serializer';

/**
 * A vehicle as an assistant reads it: the vehicle fields and depreciation settings, with the
 * account reduced to its name, currency and the estimated value. `isOwner` is false for a vehicle
 * another user shared, which the caller can read but not change. Left out: the owner id, the
 * account's balances at the start, credit limit, bank link and logo fields, and audit timestamps.
 */
export function presentVehicle({ vehicle, userId }: { vehicle: Vehicles | null | undefined; userId: number }) {
  // A vehicle is always loaded with its account; the service types allow null on a missing row.
  if (!vehicle) throw new NotFoundError({ message: t({ key: 'vehicles.notFound' }) });

  const response = serializeVehicle(vehicle);
  const account = response.account;

  return {
    id: response.id,
    accountId: response.accountId,
    isOwner: response.userId === userId,
    make: response.make,
    model: response.model,
    trim: response.trim,
    year: response.year,
    vehicleClass: response.vehicleClass,
    purchasePrice: response.purchasePrice,
    purchaseDate: response.purchaseDate,
    valueAnchor: response.valueAnchor,
    valueAnchorDate: response.valueAnchorDate,
    depreciationPreset: response.depreciationPreset,
    customAnnualRatePct: response.customAnnualRatePct,
    salvageFloorPct: response.salvageFloorPct,
    currentMileage: response.currentMileage,
    valueLastComputedAt: response.valueLastComputedAt,
    account: account && {
      name: account.name,
      currencyCode: account.currencyCode,
      currentBalance: account.currentBalance,
      refCurrentBalance: account.refCurrentBalance,
      status: account.status,
      excludeFromStats: account.excludeFromStats,
    },
  };
}
