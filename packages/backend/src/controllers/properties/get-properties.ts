import { createController } from '@controllers/helpers/controller-factory';
import { serializeProperties } from '@root/serializers/properties.serializer';
import { getProperties } from '@services/properties/get-properties.service';
import { z } from 'zod';

export default createController(z.object({}), async ({ user }) => {
  const properties = await getProperties({ userId: user.id });
  return { data: serializeProperties(properties) };
});
