import { createController } from '@controllers/helpers/controller-factory';
import * as payeesService from '@services/payees';
import { z } from 'zod';

import { bulkUpdateCategorizationModeBodySchema } from './shared-schemas';

const schema = z.object({
  body: bulkUpdateCategorizationModeBodySchema,
});

/**
 * PATCH /payees/bulk-categorization-mode
 *
 * "Apply to all Payees" quick action — flips every Payee owned by the user to
 * the supplied mode. Returns `updatedCount` so the UI can show a precise
 * confirmation toast.
 */
export default createController(schema, async ({ user, body }) => {
  const result = await payeesService.bulkUpdateCategorizationMode({
    userId: user.id,
    mode: body.mode,
  });
  return { data: result };
});
