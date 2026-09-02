import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeProperty } from '@root/serializers/properties.serializer';
import { getProperty } from '@services/properties/get-property.service';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  const property = await getProperty({ userId: user.id, propertyId: params.id });
  return { data: property ? serializeProperty(property) : null };
});
