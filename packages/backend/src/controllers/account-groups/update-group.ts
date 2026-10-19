import { recordId } from '@common/lib/zod/custom-types';
import { logoFieldsShape, refineLogoFields } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import * as accountGroupService from '@services/account-groups';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ groupId: recordId() }),
    body: z
      .object({
        name: z.string().min(1),
        parentGroupId: recordId().nullable().optional(),
        // Absent key → no change; a present key is written as given (null clears
        // it), and domain, initials and icon evict each other.
        ...logoFieldsShape,
      })
      .strict()
      .partial()
      .superRefine((data, ctx) => refineLogoFields({ data, ctx })),
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
