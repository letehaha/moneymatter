import { VENTURE_DEAL_STATUS } from '@bt/shared/types/venture';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { applyPaginationTransform, buildPagination, paginationFields } from '@controllers/helpers/pagination';
import { serializeVentureDeals } from '@root/serializers';
import { listVentureDeals } from '@services/venture/deals/list.service';
import { z } from 'zod';

export default createController(
  z.object({
    query: z
      .object({
        status: z.enum(VENTURE_DEAL_STATUS).optional(),
        platformId: recordId().optional(),
        ...paginationFields,
      })
      .transform(applyPaginationTransform),
  }),
  async ({ user, query }) => {
    const deals = await listVentureDeals({
      userId: user.id,
      status: query.status,
      platformId: query.platformId,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      data: {
        data: serializeVentureDeals(deals),
        pagination: buildPagination(query),
      },
    };
  },
);
