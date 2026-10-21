import { createController } from '@controllers/helpers/controller-factory';
import { modelField } from '@controllers/user-settings/ai-connections/connection-field-schemas';
import { createThread } from '@services/chat/threads/create.service';
import { z } from 'zod';

import { pageContextSchema, threadTitleSchema } from './shared-schemas';

const schema = z.object({
  body: z.object({
    title: threadTitleSchema.optional(),
    connectionId: z.uuid().nullable().optional(),
    // A model of that connection's provider; needs connectionId
    modelId: modelField.nullable().optional(),
    pageContext: pageContextSchema.nullable().optional(),
  }),
});

export default createController(schema, async ({ user, body }) => ({
  data: await createThread({
    userId: user.id,
    title: body.title,
    connectionId: body.connectionId,
    modelId: body.modelId,
    pageContext: body.pageContext,
  }),
  statusCode: 201,
}));
