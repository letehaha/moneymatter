import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deserializeUpdateTagReminder, serializeTagReminder } from '@root/serializers';
import * as tagRemindersService from '@services/tag-reminders';
import { z } from 'zod';

import { updateReminderBodySchema } from './shared-schemas';

const schema = z.object({
  params: z.object({
    tagId: recordId(),
    id: recordId(),
  }),
  body: updateReminderBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const { id, tagId } = params;

  // Deserialize: convert decimal amounts to cents
  const deserialized = deserializeUpdateTagReminder(body);

  const reminder = await tagRemindersService.updateReminder({
    id,
    userId: user.id,
    tagId,
    type: deserialized.type,
    frequency: deserialized.frequency,
    dayOfMonth: deserialized.dayOfMonth,
    settings: deserialized.settings,
    isEnabled: deserialized.isEnabled,
  });

  // Serialize: convert cents to decimal for API response
  return { data: serializeTagReminder(reminder) };
});
