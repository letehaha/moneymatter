import { z } from 'zod';

import { describeInputError } from '../proposals/placeholders';
import { zodToModelSchema } from './model-schema';
import { errorMessage, toolFailure } from './result-text';
import type { ChatToolDefinition, ChatToolResult, JsonSchema } from './types';

/** A tool as a module defines it, before the toolkit's guard (waiting, caps, records) wraps it. */
export type InnerToolDefinition = Omit<ChatToolDefinition, 'execute'> & {
  execute: (params: { input: unknown; callId: string }) => Promise<ChatToolResult>;
};

const schemaCache = new Map<string, JsonSchema>();

/**
 * Defines a chat-native tool from a zod shape: the model schema, the validation and the argument
 * parsing come from the one shape. A thrown error in `run` is a tool error, which the model sees.
 */
export function defineNativeTool<Shape extends z.ZodRawShape>({
  name,
  description,
  shape,
  run,
}: {
  name: string;
  description: string;
  shape: Shape;
  run: (params: { args: z.infer<z.ZodObject<Shape>>; callId: string }) => Promise<ChatToolResult>;
}): InnerToolDefinition {
  const schema = z.object(shape);
  if (!schemaCache.has(name)) schemaCache.set(name, zodToModelSchema({ schema }));

  return {
    name,
    description,
    modelSchema: schemaCache.get(name)!,
    kind: 'native',
    validate: ({ input }) => {
      const parsed = schema.safeParse(input ?? {});
      return parsed.success
        ? { success: true, value: input }
        : { success: false, error: new Error(describeInputError({ error: parsed.error })) };
    },
    execute: async ({ input, callId }) => {
      const parsed = schema.safeParse(input ?? {});
      if (!parsed.success) return toolFailure({ text: describeInputError({ error: parsed.error }) });

      try {
        return await run({ args: parsed.data, callId });
      } catch (error) {
        return toolFailure({ text: errorMessage({ error }) });
      }
    },
  };
}
