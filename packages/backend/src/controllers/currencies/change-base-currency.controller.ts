import { isoCurrencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { startBaseCurrencyChange } from '@services/currencies/start-base-currency-change.service';
import { z } from 'zod';

const schema = z.object({
  body: z.object({
    newCurrencyCode: isoCurrencyCode(),
  }),
});

export default createController(schema, async ({ user, body }) => {
  // The recalculation runs as a background job; the service validates, takes the lock and queues
  // it. Share-blocker rejections still surface synchronously here.
  const { jobId, state } = await startBaseCurrencyChange({
    userId: user.id,
    newCurrencyCode: body.newCurrencyCode,
  });

  return {
    data: { jobId, state },
    statusCode: 202,
  };
});
