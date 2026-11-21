import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTagReminder } from '@root/serializers';
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

  const reminder = await tagRemindersService.createReminder({
    userId: user.id,
    tagId,
    type: body.type,
    frequency: body.frequency ?? null,
    dayOfMonth: body.dayOfMonth ?? null,
    settings: body.settings ?? {},
    isEnabled: body.isEnabled,
  });

  return { data: serializeTagReminder(reminder) };
});
