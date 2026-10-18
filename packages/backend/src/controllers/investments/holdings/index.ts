import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { createHoldingBodySchema, deleteHoldingBodySchema } from '@controllers/investments/holdings/schemas';
import { createHoldingFromInput } from '@services/investments/holdings/create-holding-from-input.service';
import { deleteHolding } from '@services/investments/holdings/delete-holding.service';
import { getHoldings } from '@services/investments/holdings/get-holdings.service';
import { z } from 'zod';

export const createHoldingController = createController(
  z.object({ body: createHoldingBodySchema }),
  async ({ user, body }) => {
    const { portfolioId, securityId, searchResult } = body;

    const holding = await createHoldingFromInput({ userId: user.id, portfolioId, securityId, searchResult });
    return { data: holding, statusCode: 201 };
  },
);

export const getHoldingsController = createController(
  z.object({
    params: z.object({ portfolioId: recordId() }),
    query: z.object({
      securityId: recordId().optional(),
      date: z
        .string()
        .optional()
        .transform((val) => (val ? new Date(val) : undefined)),
    }),
  }),
  async ({ user, params, query }) => {
    const holdings = await getHoldings({
      userId: user.id,
      portfolioId: params.portfolioId,
      securityId: query.securityId,
      date: query.date,
    });

    return { data: holdings };
  },
);

export const deleteHoldingController = createController(
  z.object({ body: deleteHoldingBodySchema }),
  async ({ user, body }) => {
    const { id: userId } = user;
    const { portfolioId, securityId, force } = body;
    await deleteHolding({ userId, portfolioId, securityId, force });
    return { statusCode: 200 };
  },
);
