import { ACCOUNT_CATEGORIES, ACCOUNT_TYPES, DEPRECIATION_PRESET, VEHICLE_CLASS } from '@bt/shared/types';
import { roundToCurrency } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import Accounts, { createAccount as createAccountInDb } from '@models/accounts.model';
import Vehicles from '@models/vehicles.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';
import { parseISO } from 'date-fns';

import { computeVehicleValue } from './compute-vehicle-value';

interface CreateVehicleParams {
  userId: number;
  name: string;
  currencyCode: string;
  make: string;
  model: string;
  trim?: string | null;
  year: number;
  vehicleClass: VEHICLE_CLASS;
  purchasePrice: Money;
  purchaseDate: string;
  depreciationPreset?: DEPRECIATION_PRESET;
  customAnnualRatePct?: number | null;
  salvageFloorPct?: number;
  currentMileage?: number | null;
}

const createVehicleImpl = async (params: CreateVehicleParams) => {
  const {
    userId,
    name,
    currencyCode,
    make,
    model,
    trim = null,
    year,
    vehicleClass,
    purchasePrice,
    purchaseDate,
    depreciationPreset = DEPRECIATION_PRESET.classDefault,
    customAnnualRatePct = null,
    salvageFloorPct = 10,
    currentMileage = null,
  } = params;

  if (depreciationPreset === DEPRECIATION_PRESET.custom && customAnnualRatePct == null) {
    throw new ValidationError({
      message: 'customAnnualRatePct is required when depreciationPreset = custom',
    });
  }

  await ensureUserCurrencyConnected({ userId, currencyCode });

  const now = new Date();
  const anchorDate = parseISO(purchaseDate);

  // The depreciation curve starts from a price held at the currency's decimals.
  const anchorPrice = await roundToCurrency({ money: purchasePrice, userId, currencyCode, mode: 'half-up' });

  // Compute today's depreciated value — that becomes the account's initial balance.
  // Historical Balances rows are not backfilled in P1 (documented limitation).
  const currentValue = await roundToCurrency({
    money: computeVehicleValue({
      anchorValue: anchorPrice,
      anchorDate,
      asOf: now,
      vehicleClass,
      preset: depreciationPreset,
      customAnnualRatePct,
      salvageFloorPct,
    }),
    userId,
    currencyCode,
    mode: 'half-up',
  });

  const refCurrentValue = await calculateRefAmount({
    userId,
    amount: currentValue,
    baseCode: currencyCode,
    date: now,
  });

  const zero = Money.zero();

  const account = await createAccountInDb({
    userId,
    name,
    currencyCode,
    accountCategory: ACCOUNT_CATEGORIES.vehicle,
    type: ACCOUNT_TYPES.system,
    initialBalance: currentValue,
    refInitialBalance: refCurrentValue,
    creditLimit: zero,
    refCreditLimit: zero,
  });

  if (!account) {
    throw new ValidationError({ message: 'Failed to create vehicle account' });
  }

  const vehicle = await Vehicles.create({
    accountId: account.id,
    userId,
    make,
    model,
    trim,
    year,
    vehicleClass,
    purchasePrice: anchorPrice,
    purchaseDate,
    depreciationPreset,
    customAnnualRatePct,
    salvageFloorPct,
    currentMileage,
    valueLastComputedAt: now,
  });

  return loadVehicleWithAccount({ vehicleId: vehicle.id });
};

export const createVehicle = withTransaction(createVehicleImpl);

const loadVehicleWithAccount = async ({ vehicleId }: { vehicleId: string }) => {
  return Vehicles.findByPk(vehicleId, {
    include: [{ model: Accounts }],
  });
};
