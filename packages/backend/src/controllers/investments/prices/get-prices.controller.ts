import { createController } from '@controllers/helpers/controller-factory';
import { securityPricesQuerySchema } from '@controllers/investments/prices/schemas';
import { getPrices } from '@root/services/investments/securities-price/get-prices.service';
import { z } from 'zod';

export default createController(z.object({ query: securityPricesQuerySchema }), async (req) => {
  const { securityId, from, to } = req.query;

  const prices = await getPrices({
    securityId,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  });

  return { data: prices };
});
