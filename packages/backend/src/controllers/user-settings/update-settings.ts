import { createController } from '@controllers/helpers/controller-factory';
import { ZodSettingsSchema } from '@models/user-settings.model';
import * as userSettingsService from '@services/user-settings/update-settings';
import { z } from 'zod';

/**
 * Service-owned slices and `fire` are dropped unvalidated. `fire` is PATCH-only: PUT echoes the
 * client's cached copy, which can be older than the stored one, and a stored `fire` that fails a
 * later-tightened limit must not break unrelated PUTs.
 */
const ZodUpdateSettingsBodySchema = ZodSettingsSchema.omit({ fire: true, fireHistory: true }).extend({
  ai: ZodSettingsSchema.shape.ai.unwrap().omit({ connections: true, featureConfigs: true, chat: true }).optional(),
});

const schema = z.object({
  body: ZodUpdateSettingsBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;

  const data = await userSettingsService.updateUserSettings({
    userId,
    settings: body,
  });

  return { data };
});
