import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTagReminder } from '@root/serializers';
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

  const reminder = await tagRemindersService.updateReminder({
    id,
    userId: user.id,
    tagId,
    type: body.type,
    frequency: body.frequency,
    dayOfMonth: body.dayOfMonth,
    settings: body.settings,
    isEnabled: body.isEnabled,
  });

  return { data: serializeTagReminder(reminder) };
});
