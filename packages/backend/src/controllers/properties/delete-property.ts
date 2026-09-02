import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deleteProperty } from '@services/properties/delete-property.service';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  await deleteProperty({ userId: user.id, propertyId: params.id });
  return { data: { id: params.id } };
});
