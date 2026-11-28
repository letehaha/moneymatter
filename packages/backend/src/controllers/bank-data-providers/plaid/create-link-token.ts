import { createController } from '@controllers/helpers/controller-factory';
import { plaidProvider } from '@services/bank-data-providers/plaid';
import { z } from 'zod';

export default createController(z.object({}), async ({ res, user }) => {
  res.set('Cache-Control', 'no-store');
  const data = await plaidProvider.createLinkToken({ userId: user.id });
  return { data };
});
