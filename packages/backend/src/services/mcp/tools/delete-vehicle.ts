import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteVehicle } from '@services/vehicles/delete-vehicle.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  vehicleId: recordId().describe('ID of the vehicle to delete (from get_vehicles)'),
};

export function registerDeleteVehicle(server: McpServer) {
  server.registerTool(
    'delete_vehicle',
    {
      description:
        "Permanently delete a vehicle together with its account and the account's history. This action is irreversible: confirm with the user before calling. Only the owner can delete a vehicle. Requires finance:delete scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_vehicle', clientId: extra.authInfo?.clientId });

      await deleteVehicle({ userId, vehicleId: args.vehicleId });

      return jsonContent({ data: { deleted: true, id: args.vehicleId } });
    },
  );
}
