import { createController } from '@controllers/helpers/controller-factory';
import { serializeVehicle } from '@root/serializers/vehicles.serializer';
import { createVehicle } from '@services/vehicles/create-vehicle.service';
import { createVehicleBodySchema } from '@services/vehicles/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  body: createVehicleBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const vehicle = await createVehicle({
    userId: user.id,
    ...body,
  });

  return {
    data: vehicle ? serializeVehicle(vehicle) : null,
    statusCode: 201,
  };
});
