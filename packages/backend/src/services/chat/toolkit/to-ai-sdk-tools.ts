import { jsonSchema, tool, type Tool } from 'ai';

import type { ChatToolkit } from './types';

/**
 * The toolkit as AI SDK tools. The provider gets the toolkit's own model schema object, whose
 * `validate` hook only checks (the input reaches `execute` unchanged, refs and `_chat` included). A
 * failed call throws, which the SDK turns into a tool error the model sees and the run goes on.
 */
export function toAiSdkTools({ toolkit }: { toolkit: ChatToolkit }): Record<string, Tool> {
  return Object.fromEntries(
    toolkit.tools.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema(definition.modelSchema as Parameters<typeof jsonSchema>[0], {
          validate: (value) => definition.validate({ input: value }),
        }),
        execute: async (input, { toolCallId }) => {
          const result = await definition.execute({ input, callId: toolCallId });
          if (result.isError) throw new Error(result.text);
          return result.text;
        },
      }),
    ]),
  );
}
