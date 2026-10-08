import { LINK_RESIDUAL_TARGETS } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as accountsService from '@services/accounts.service';
import z from 'zod';

export default createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
    body: z.object({
      connectionId: recordId(),
      externalAccountId: z.string(),
      residualTarget: z.enum(LINK_RESIDUAL_TARGETS).optional(),
    }),
  }),
  async ({ user, params, body }) => {
    const result = await accountsService.linkAccountToBankConnection({
      accountId: params.id,
      connectionId: body.connectionId,
      externalAccountId: body.externalAccountId,
      residualTarget: body.residualTarget,
      userId: user.id,
    });

    return {
      data: {
        account: result.account,
        balanceDifference: result.balanceDifference,
        message: 'Account linked successfully.',
      },
    };
  },
);
