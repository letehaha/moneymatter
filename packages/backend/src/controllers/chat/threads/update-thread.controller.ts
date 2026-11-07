import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { modelField } from '@controllers/user-settings/ai-connections/connection-field-schemas';
import { updateThread } from '@services/chat/threads/update.service';
import { z } from 'zod';

import { pageContextSchema, threadTitleSchema } from './shared-schemas';

const schema = z.object({
  params: z.object({ id: recordId() }),
  body: z
    .object({
      title: threadTitleSchema.optional(),
      pinned: z.boolean().optional(),
      // null picks the included model
      connectionId: z.uuid().nullable().optional(),
      // null picks the connection's own model
      modelId: modelField.nullable().optional(),
      // null removes the page
      pageContext: pageContextSchema.nullable().optional(),
    })
    .refine(
      (body) =>
        body.title !== undefined ||
        body.pinned !== undefined ||
        body.connectionId !== undefined ||
        body.modelId !== undefined ||
        body.pageContext !== undefined,
      { message: 'Provide a title, pinned, connectionId, modelId or pageContext' },
    ),
});

export default createController(schema, async ({ user, params, body }) => ({
  data: await updateThread({
    userId: user.id,
    threadId: params.id,
    title: body.title,
    pinned: body.pinned,
    connectionId: body.connectionId,
    modelId: body.modelId,
    pageContext: body.pageContext,
  }),
}));
