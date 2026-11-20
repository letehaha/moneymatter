import { recordId } from '@common/lib/zod/custom-types';
import { getVehicle } from '@services/vehicles/get-vehicle.service';
import { getVehicles } from '@services/vehicles/get-vehicles.service';

import { defineTool } from '../define-tool';
import { presentVehicle } from './vehicle-output';

export const getVehiclesTool = defineTool({
  name: 'get_vehicles',
  toolset: 'loans-vehicles',
  access: 'read',
  description:
    'List the vehicles (cars and other vehicles tracked as an asset), or read one with vehicleId. Each vehicle has make, model, trim, year, vehicleClass, purchasePrice and purchaseDate, the depreciation settings (depreciationPreset, customAnnualRatePct, salvageFloorPct), currentMileage, and its account: account.currentBalance is the estimated value today, computed from a depreciation curve (in the vehicle currency, refCurrentBalance in the base currency). valueAnchor and valueAnchorDate are the last manual value the curve starts from (null: the purchase price and date). isOwner is false for a vehicle another user shared with you, which cannot be changed. To set the estimated value by hand, call adjust_account_balance with the vehicle accountId. All amounts are decimals.',
  input: {
    vehicleId: recordId()
      .optional()
      .describe(
        'Vehicle ID (the id of a vehicle in the list). Omit to list every vehicle; pass it to read one vehicle',
      ),
  },
  run: async ({ userId, args }) => {
    if (args.vehicleId) {
      const vehicle = await getVehicle({ userId, vehicleId: args.vehicleId });
      return presentVehicle({ vehicle, userId });
    }

    const vehicles = await getVehicles({ userId });
    return vehicles.map((vehicle) => presentVehicle({ vehicle, userId }));
  },
});
