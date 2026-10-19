import { recordId } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFieldsOnCreate } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import * as accountGroupService from '@services/account-groups';
import { z } from 'zod';

export default createController(
  z.object({
    body: z
      .object({
        name: z.string().min(1),
        parentGroupId: recordId().nullable().optional(),
        // Absent key → column stays null; domain, initials and icon evict each other.
        ...logoFieldsShape,
      })
      .strict()
      .superRefine((data, ctx) => refineLogoFieldsOnCreate({ data, ctx })),
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
