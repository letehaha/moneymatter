import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getVehicle } from '@services/vehicles/get-vehicle.service';
import { getVehicles } from '@services/vehicles/get-vehicles.service';

import { getUserId, jsonContent } from './helpers';
import { presentVehicle } from './vehicle-output';

const inputSchema = {
  vehicleId: recordId()
    .optional()
    .describe('Vehicle ID (the id of a vehicle in the list). Omit to list every vehicle; pass it to read one vehicle'),
};

export function registerGetVehicles(server: McpServer) {
  server.registerTool(
    'get_vehicles',
    {
      description:
        'List the vehicles (cars and other vehicles tracked as an asset), or read one with vehicleId. Each vehicle has make, model, trim, year, vehicleClass, purchasePrice and purchaseDate, the depreciation settings (depreciationPreset, customAnnualRatePct, salvageFloorPct), currentMileage, and its account: account.currentBalance is the estimated value today, computed from a depreciation curve (in the vehicle currency, refCurrentBalance in the base currency). valueAnchor and valueAnchorDate are the last manual value the curve starts from (null: the purchase price and date). isOwner is false for a vehicle another user shared with you, which cannot be changed. To set the estimated value by hand, call adjust_account_balance with the vehicle accountId. All amounts are decimals.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_vehicles', clientId: extra.authInfo?.clientId });

      if (args.vehicleId) {
        const vehicle = await getVehicle({ userId, vehicleId: args.vehicleId });
        return jsonContent({ data: presentVehicle({ vehicle, userId }) });
      }

      const vehicles = await getVehicles({ userId });
      return jsonContent({ data: vehicles.map((vehicle) => presentVehicle({ vehicle, userId })) });
    },
  );
}
