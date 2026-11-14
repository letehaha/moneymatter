import { SHARE_PERMISSIONS, TRANSACTIONS_WRITE_SCOPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { createInvitation } from '@services/sharing/invitations/create-invitation.service';
import { z } from 'zod';

import { shareableResourceTypeEnum } from './_zod';

const schema = z.object({
  body: z.object({
    inviteeEmail: z.email().max(320).trim(),
    resourceType: shareableResourceTypeEnum,
    resourceId: z.union([z.coerce.number().int().positive(), recordId()]),
    permission: z.enum([SHARE_PERMISSIONS.read, SHARE_PERMISSIONS.write, SHARE_PERMISSIONS.manage] as const),
    policy: z
      .object({
        transactionsWriteScope: z
          .enum([TRANSACTIONS_WRITE_SCOPES.all, TRANSACTIONS_WRITE_SCOPES.own] as const)
          .optional(),
      })
      .nullable()
      .optional(),
  }),
});

export default createController(schema, async ({ user, body }) => {
  const { invitation, emailOutcome } = await createInvitation({
    ownerUserId: user.id,
    inviteeEmail: body.inviteeEmail,
    resourceType: body.resourceType,
    resourceId: body.resourceId,
    permission: body.permission,
    policy: body.policy ?? null,
  });

  // `emailOutcome` lets the frontend tell the owner when the row was created but no email
  // went out — otherwise they see "success" and never learn the invitee got nothing.
  return { data: { ...invitation, emailOutcome }, statusCode: 201 };
});
