import { dateBound } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getPortfoliosAnnualizedReturns } from '@services/investments/portfolios/get-portfolios-annualized-returns.service';
import { z } from 'zod';

const schema = z.object({
  query: z.object({ asOf: dateBound().optional() }).optional(),
});

export default createController(schema, async ({ user, query }) => {
  const data = await getPortfoliosAnnualizedReturns({ userId: user.id, asOf: query?.asOf });
  return { data };
});
