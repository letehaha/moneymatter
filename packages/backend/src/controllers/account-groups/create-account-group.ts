import { createController } from '@controllers/helpers/controller-factory';
import * as accountGroupService from '@services/account-groups';
import { z } from 'zod';

import { createAccountGroupBodySchema } from './account-group-body.schema';

export default createController(
  z.object({
    body: createAccountGroupBodySchema,
  }),
  async ({ user, body }) => {
    const { name, parentGroupId, logoDomain, logoInitials, logoColor, logoIcon } = body;

    const data = await accountGroupService.createAccountGroup({
      userId: user.id,
      name,
      parentGroupId,
      logoDomain,
      logoInitials,
      logoColor,
      logoIcon,
    });

    return { data };
  },
);
