import { randomUUID } from 'crypto';

import { getToolCatalog, type ToolCatalogEntry } from '../../mcp/tool-catalog';
import { CHAT_CORE_TOOLS } from '../policies/core-tools';
import { CHAT_EXCLUDED_TOOLS } from '../policies/excluded';
import { createAskClarificationTool, CLARIFICATION_WAITING_MESSAGE } from './ask-clarification';
import { runCatalogRead } from './catalog-read';
import { buildChatReadExtra } from './extras';
import { createFindCapabilitiesTool } from './find-capabilities';
import { createRunLimits } from './limits';
import { createInputValidator, getModelSchema } from './model-schema';
import type { InnerToolDefinition } from './native-tool';
import { proposeToolCall } from './propose';
import { createReadAttachmentTool } from './read-attachment';
import { createRenderTools } from './render-visual';
import { compactArgs, errorMessage, toolFailure } from './result-text';
import { createRunAnalysisTool } from './run-analysis';
import { createSetThreadTitleTool } from './set-thread-title';
import type { ChatToolContext, ChatToolDefinition, ChatToolkit, ChatToolkitRun, ChatToolkitState } from './types';

const RESULT_SUMMARY_CHARS = 200;

function catalogTool({ ctx, entry }: { ctx: ChatToolContext; entry: ToolCatalogEntry }): InnerToolDefinition {
  const isRead = entry.access === 'read';

  return {
    name: entry.name,
    description: entry.description,
    modelSchema: getModelSchema({ entry }),
    kind: isRead ? 'read' : 'write',
    validate: createInputValidator({ entry }),
    execute: ({ input, callId }) =>
      isRead ? runCatalogRead({ ctx, entry, input, callId }) : proposeToolCall({ ctx, entry, input }),
  };
}

/**
 * One toolkit per run: every capability of the MCP catalog as a transport-neutral definition, plus the
 * tools only the chat has. Reads run
 * the original handler with read-only scopes. A write never runs its handler: it becomes a proposal.
 * The toolkit owns the per-message limits and the "waiting for the answer" rule, so they hold
 * whichever runner calls it.
 */
export function buildChatToolkit({
  run,
  catalog = getToolCatalog(),
}: {
  run: ChatToolkitRun;
  catalog?: readonly ToolCatalogEntry[];
}): ChatToolkit {
  const state: ChatToolkitState = {
    awaitingClarification: false,
    discovered: new Set(),
    reads: new Map(),
    sources: [],
    limits: createRunLimits(),
    visuals: 0,
    analyses: new Map(),
    noticed: new Set(),
    records: [],
  };

  let extra: ReturnType<typeof buildChatReadExtra> | null = null;
  const ctx: ChatToolContext = {
    run,
    state,
    catalog,
    getExtra: () => (extra ??= buildChatReadExtra({ user: run.user })),
    notice: async ({ key, params = {} }) => {
      if (state.noticed.has(key)) return;
      state.noticed.add(key);
      await run.emit({ type: 'part.started', part: { type: 'notice', id: randomUUID(), key, params } });
    },
  };

  const inner: InnerToolDefinition[] = [
    ...catalog.filter((entry) => !(entry.name in CHAT_EXCLUDED_TOOLS)).map((entry) => catalogTool({ ctx, entry })),
    createFindCapabilitiesTool({ ctx }),
    createAskClarificationTool({ ctx }),
    ...createRenderTools({ ctx }),
    createReadAttachmentTool({ ctx }),
    createSetThreadTitleTool({ ctx }),
    createRunAnalysisTool({ ctx }),
  ];

  const guard = (definition: InnerToolDefinition): ChatToolDefinition => ({
    ...definition,
    execute: async ({ input, callId = randomUUID() }) => {
      // Once the run waits for an answer it does nothing else, whatever the model tries next.
      if (state.awaitingClarification) return toolFailure({ text: CLARIFICATION_WAITING_MESSAGE });

      // A proposal has its own cap; every other call counts against the tool-call cap.
      if (definition.kind !== 'write') {
        const taken = state.limits.take({ kind: 'toolCalls' });
        if (!taken.ok) {
          await ctx.notice({ key: taken.noticeKey, params: { limit: taken.limit } });
          return toolFailure({ text: taken.message });
        }
      }

      const record: ChatToolkitState['records'][number] = {
        callId,
        toolName: definition.name,
        args: compactArgs({ args: input }),
        status: 'running',
      };
      state.records.push(record);
      const startedAt = Date.now();

      let result;
      try {
        result = await definition.execute({ input, callId });
      } catch (error) {
        result = toolFailure({ text: errorMessage({ error }) });
      }

      record.status = result.isError ? 'error' : 'ok';
      record.durationMs = Date.now() - startedAt;
      const summary = (result.summary ?? result.text).slice(0, RESULT_SUMMARY_CHARS);
      if (result.isError) record.error = summary;
      else record.resultSummary = summary;

      return result;
    },
  });

  const tools = inner.map(guard);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const nativeNames = tools.filter((tool) => tool.kind === 'native').map((tool) => tool.name);

  return {
    tools,
    getTool: ({ name }) => byName.get(name),
    activeToolNames: () =>
      [...new Set([...CHAT_CORE_TOOLS, ...nativeNames, ...state.discovered])].filter((name) => byName.has(name)),
    isAwaitingClarification: () => state.awaitingClarification,
    getReadResult: ({ callId }) => state.reads.get(callId)?.fullText ?? null,
    toolCallRecords: () => state.records,
  };
}
