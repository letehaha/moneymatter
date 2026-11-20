import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as accountGroupService from '@services/account-groups';
import { z } from 'zod';

import { updateAccountGroupBodySchema } from './account-group-body.schema';

export default createController(
  z.object({
    params: z.object({ groupId: recordId() }),
    body: updateAccountGroupBodySchema,
  }),
  async ({ user, params, body }) => {
    const group = await accountGroupService.updateAccountGroup({
      groupId: params.groupId,
      userId: user.id,
      ...body,
    });

    // Clients read the updated group out of a single-element list.
    return { data: [group] };
  },
);
