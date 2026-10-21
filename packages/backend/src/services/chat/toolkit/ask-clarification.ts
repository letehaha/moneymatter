import { CHAT_CLARIFICATION_LIMITS } from '@bt/shared/types';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { ToolInputError } from '../proposals/placeholders';
import { defineNativeTool } from './native-tool';
import { toolSuccess } from './result-text';
import type { ChatToolContext } from './types';

const LIMITS = CHAT_CLARIFICATION_LIMITS;

export const CLARIFICATION_WAITING_MESSAGE =
  "Waiting for the user's answer to your question. Do not call any more tools; end your turn now.";

export function createAskClarificationTool({ ctx }: { ctx: ChatToolContext }) {
  return defineNativeTool({
    name: 'ask_clarification',
    description:
      'Ask the user a question when something material is ambiguous (which account, which transaction, which amount or date). The run stops and resumes with the answer. For reasonable defaults, propose with `_chat.uncertain` instead. Give two or more options, or allow free text.',
    shape: {
      question: z.string().trim().min(1).max(LIMITS.questionMaxChars).describe('In the language of the user'),
      options: z
        .array(
          z
            .object({
              id: z.string().min(1).max(40).optional(),
              label: z.string().trim().min(1).max(LIMITS.optionLabelMaxChars),
            })
            .strict(),
        )
        .max(LIMITS.maxOptions)
        .describe('May be empty only when free text is allowed'),
      allowFreeText: z.boolean().optional(),
      multiSelect: z.boolean().optional(),
    },
    run: async ({ args }) => {
      const allowFreeText = args.allowFreeText ?? false;
      if (args.options.length < 2 && !allowFreeText) {
        throw new ToolInputError('Give at least two options, or allow free text');
      }

      const options = args.options.map((option, index) => ({ id: option.id ?? `o${index + 1}`, label: option.label }));
      if (new Set(options.map((option) => option.id)).size !== options.length) {
        throw new ToolInputError('Option ids must be unique');
      }

      ctx.state.awaitingClarification = true;
      await ctx.run.emit({
        type: 'part.started',
        part: {
          type: 'clarification',
          id: randomUUID(),
          question: args.question,
          options,
          allowFreeText,
          multiSelect: args.multiSelect ?? false,
        },
      });
      await ctx.run.textPolicy.cardCreated();

      return toolSuccess({ text: `The question is shown to the user. ${CLARIFICATION_WAITING_MESSAGE}` });
    },
  });
}
