import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deserializeCreateTagReminder, serializeTagReminder } from '@root/serializers';
import * as tagRemindersService from '@services/tag-reminders';
import { z } from 'zod';

import { createReminderBodySchema } from './shared-schemas';

const schema = z.object({
  params: z.object({
    tagId: recordId(),
  }),
  body: createReminderBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const { tagId } = params;

  const deserialized = deserializeCreateTagReminder(body);

  const reminder = await tagRemindersService.createReminder({
    userId: user.id,
    tagId,
    type: deserialized.type,
    frequency: deserialized.frequency ?? null,
    dayOfMonth: deserialized.dayOfMonth ?? null,
    settings: deserialized.settings ?? {},
    isEnabled: deserialized.isEnabled,
  });

  return { data: serializeTagReminder(reminder) };
});
