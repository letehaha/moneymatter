import { createController } from '@controllers/helpers/controller-factory';
import { deleteVehicle } from '@services/vehicles/delete-vehicle.service';
import { vehicleIdParamsSchema } from '@services/vehicles/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: vehicleIdParamsSchema,
});

export default createController(schema, async ({ user, params }) => {
  await deleteVehicle({ userId: user.id, vehicleId: params.id });
  return { data: { id: params.id } };
});
