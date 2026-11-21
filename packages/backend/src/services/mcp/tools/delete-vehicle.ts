import { recordId } from '@common/lib/zod/custom-types';
import { deleteVehicle } from '@services/vehicles/delete-vehicle.service';

import { defineTool } from '../define-tool';

export const deleteVehicleTool = defineTool({
  name: 'delete_vehicle',
  toolset: 'loans-vehicles',
  access: 'delete',
  description:
    "Permanently delete a vehicle together with its account and the account's history. This action is irreversible: confirm with the user before calling. Only the owner can delete a vehicle.",
  input: {
    vehicleId: recordId().describe('ID of the vehicle to delete (from get_vehicles)'),
  },
  run: async ({ userId, args }) => {
    await deleteVehicle({ userId, vehicleId: args.vehicleId });

    return { deleted: true, id: args.vehicleId };
  },
});
