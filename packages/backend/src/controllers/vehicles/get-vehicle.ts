import { createController } from '@controllers/helpers/controller-factory';
import { serializeVehicle } from '@root/serializers/vehicles.serializer';
import { getVehicle } from '@services/vehicles/get-vehicle.service';
import { vehicleIdParamsSchema } from '@services/vehicles/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: vehicleIdParamsSchema,
});

export default createController(schema, async ({ user, params }) => {
  const vehicle = await getVehicle({ userId: user.id, vehicleId: params.id });
  return { data: vehicle ? serializeVehicle(vehicle) : null };
});
