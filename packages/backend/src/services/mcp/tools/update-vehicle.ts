import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateVehicle } from '@services/vehicles/update-vehicle.service';
import { updateVehicleBodyFields, updateVehicleBodySchema } from '@services/vehicles/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentVehicle } from './vehicle-output';

const inputSchema = {
  vehicleId: recordId().describe('ID of the vehicle to update (from get_vehicles)'),
  ...updateVehicleBodyFields,
  name: updateVehicleBodyFields.name.describe('New name of the vehicle account'),
  trim: updateVehicleBodyFields.trim.describe('Trim level; null clears it'),
  year: updateVehicleBodyFields.year.describe('Model year, 1900 up to next year'),
  vehicleClass: updateVehicleBodyFields.vehicleClass.describe(
    'Class of the vehicle. A change recomputes the estimated value',
  ),
  depreciationPreset: updateVehicleBodyFields.depreciationPreset.describe(
    'Depreciation curve. A change recomputes the estimated value; "custom" needs customAnnualRatePct',
  ),
  customAnnualRatePct: updateVehicleBodyFields.customAnnualRatePct.describe(
    'Flat yearly depreciation in percent (0-100). A change recomputes the estimated value',
  ),
  salvageFloorPct: updateVehicleBodyFields.salvageFloorPct.describe(
    'Lowest value as a percent of the purchase price (0-100). A change recomputes the estimated value',
  ),
  currentMileage: updateVehicleBodyFields.currentMileage.describe('Odometer reading, a whole number; null clears it'),
};

export function registerUpdateVehicle(server: McpServer) {
  server.registerTool(
    'update_vehicle',
    {
      description:
        'Update a vehicle. Only the fields you send change. Editable: name, make, model, trim, year, vehicleClass, depreciationPreset, customAnnualRatePct, salvageFloorPct, currentMileage. Send null to clear trim, customAnnualRatePct or currentMileage. The purchase price, purchase date and currency cannot be changed (delete the vehicle and create it again for those). A change to the class, preset, rate or floor recomputes the estimated value. To set the estimated value by hand use adjust_account_balance. Returns the vehicle. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_vehicle', clientId: extra.authInfo?.clientId });

      const { vehicleId, ...body } = args;
      const vehicle = await updateVehicle({ userId, vehicleId, ...updateVehicleBodySchema.parse(body) });

      return jsonContent({ data: presentVehicle({ vehicle, userId }) });
    },
  );
}
