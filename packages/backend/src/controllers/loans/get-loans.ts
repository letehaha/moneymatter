import { createController } from '@controllers/helpers/controller-factory';
import { getLoanViews } from '@services/loans/get-loan-views.service';
import { z } from 'zod';

export default createController(z.object({}), async ({ user }) => {
  return { data: await getLoanViews({ userId: user.id }) };
});
