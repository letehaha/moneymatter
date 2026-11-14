import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { booleanQuery } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { applyPaginationTransform, buildPagination, paginationFields } from '@controllers/helpers/pagination';
import { listPortfolios } from '@services/investments/portfolios/list.service';
import { z } from 'zod';

export default createController(
  z.object({
    query: z
      .object({
        portfolioType: z.enum(PORTFOLIO_TYPE).optional(),
        isEnabled: booleanQuery().optional(),
        onlyDeleted: booleanQuery().optional(),
        ...paginationFields,
      })
      .transform(applyPaginationTransform),
  }),
  async ({ user, query }) => {
    const portfolios = await listPortfolios({
      userId: user.id,
      portfolioType: query.portfolioType,
      isEnabled: query.isEnabled,
      onlyDeleted: query.onlyDeleted,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      data: {
        data: portfolios,
        pagination: buildPagination(query),
      },
    };
  },
);
