import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getPortfolioSummary } from '@services/investments/portfolios/get-portfolio-summary.service';
import { z } from 'zod';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  query: z
    .object({
      date: z.iso.datetime().optional(),
    })
    .optional()
    .default({}),
});

export default createController(schema, async ({ user, params, query }) => {
  const date = query?.date ? new Date(query.date) : undefined;

  const portfolioSummary = await getPortfolioSummary({
    userId: user.id,
    portfolioId: params.id,
    date,
  });

  return { data: portfolioSummary };
});
