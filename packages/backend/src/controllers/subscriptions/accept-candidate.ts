import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { resolveCandidate } from '@services/subscriptions/resolve-candidate';
import { z } from 'zod';

import { acceptCandidateBodySchema } from './shared-schemas';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: acceptCandidateBodySchema.optional(),
});

export default createController(schema, async ({ user, params, body }) => {
  const result = await resolveCandidate({
    userId: user.id,
    candidateId: params.id,
    subscriptionId: body?.subscriptionId,
  });

  return { data: result };
});
