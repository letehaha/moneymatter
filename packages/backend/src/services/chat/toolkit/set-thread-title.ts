import { CHAT_THREAD_TITLE_MAX_CHARS } from '@bt/shared/types';
import ChatThreads from '@models/chat-threads.model';
import { z } from 'zod';

import { notifyThreadUpdated } from '../threads/thread-events';
import { sanitizeModelThreadTitle } from '../threads/thread-title';
import { defineNativeTool } from './native-tool';
import { toolFailure, toolSuccess } from './result-text';
import type { ChatToolContext } from './types';

/**
 * Names the conversation. The model calls it once, in its first turn, so the title costs no call of its
 * own. The title is text the model wrote, so it passes `sanitizeModelThreadTitle` and is stored as plain
 * text. It replaces only the title the first words gave (`auto`): a title the user typed, or one the model
 * already gave, stays.
 */
export function createSetThreadTitleTool({ ctx }: { ctx: ChatToolContext }) {
  return defineNativeTool({
    name: 'set_thread_title',
    description:
      'Name this conversation, once, in your first turn: 3 to 6 words in the language of the user, plain text. Ignored when the conversation already has a name.',
    shape: {
      title: z
        .string()
        .min(1)
        .max(CHAT_THREAD_TITLE_MAX_CHARS * 2),
    },
    run: async ({ args }) => {
      const title = sanitizeModelThreadTitle({ title: args.title });
      if (!title) return toolFailure({ text: 'The title is empty. Give 3 to 6 words.' });

      const [updated] = await ChatThreads.update(
        { title, titleSource: 'model' },
        { where: { id: ctx.run.threadId, userId: ctx.run.user.id, titleSource: 'auto' } },
      );
      if (updated === 0) return toolSuccess({ text: 'The conversation already has a name. Carry on.' });

      notifyThreadUpdated({ userId: ctx.run.user.id, threadId: ctx.run.threadId });
      return toolSuccess({ text: 'Named. Carry on.' });
    },
  });
}
