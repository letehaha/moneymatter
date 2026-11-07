import { createController } from '@controllers/helpers/controller-factory';
import { dismissTransferSuggestion } from '@services/transactions/transactions-linking/dismiss-transfer-suggestion.service';
import { dismissBodySchema } from '@services/transactions/transactions-linking/recommendation-schemas';
import { z } from 'zod';

const schema = z.object({
  body: dismissBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  await dismissTransferSuggestion({ userId: user.id, ...body });

  return { statusCode: 204 };
});
