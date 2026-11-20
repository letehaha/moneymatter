import { createController } from '@controllers/helpers/controller-factory';
import * as tagsService from '@services/tags';
import * as onboardingService from '@services/user-settings/onboarding';
import { z } from 'zod';

import { createTagBodySchema } from './shared-schemas';

const schema = z.object({
  body: createTagBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const { name, color, icon, description } = body;

  const data = await tagsService.createTag({
    userId: user.id,
    name,
    color,
    icon: icon ?? null,
    description: description ?? null,
  });

  // Mark onboarding task as complete (fire and forget)
  onboardingService.markTaskComplete({ userId: user.id, taskId: 'create-tag' }).catch(() => {});

  return { data };
});
