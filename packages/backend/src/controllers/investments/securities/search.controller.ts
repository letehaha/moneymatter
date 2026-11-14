import { ASSET_CLASS } from '@bt/shared/types/investments';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { searchSecurities } from '@services/investments/securities/search.service';
import { z } from 'zod';

export default createController(
  z.object({
    query: z.object({
      query: z.string().min(1, 'Search query cannot be empty.'),
      limit: z.coerce.number().int().positive().optional(),
      portfolioId: recordId().optional(),
      assetClass: z.enum(ASSET_CLASS).optional(),
    }),
  }),
  async ({ user, query }) => {
    const securities = await searchSecurities({
      query: query.query,
      limit: query.limit,
      portfolioId: query.portfolioId,
      assetClass: query.assetClass,
      user,
    });
    return { data: securities };
  },
);
