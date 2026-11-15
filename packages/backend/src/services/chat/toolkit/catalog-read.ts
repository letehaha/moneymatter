import { z } from 'zod';

import type { ToolCatalogEntry } from '../../mcp/tool-catalog';
import { THIRD_PARTY_READ_TOOLS } from '../policies/explicit';
import { describeInputError } from '../proposals/placeholders';
import { capForModel, compactArgs, compactJsonText, errorMessage, toolFailure, toolSuccess } from './result-text';
import type { ChatToolContext, ChatToolResult } from './types';

type CatalogReadOutcome = { ok: true; fullText: string } | { ok: false; failure: ChatToolResult };

/**
 * Runs a catalog read with the read-only `extra`: the tool's own schema and validators first (the
 * SDK would have run them for an MCP client), the third-party cap, then the handler. Both the
 * model's own reads and the reads an analysis makes for its inputs go through here.
 */
export async function readFromCatalog({
  ctx,
  entry,
  input,
}: {
  ctx: ChatToolContext;
  entry: ToolCatalogEntry;
  input: unknown;
}): Promise<CatalogReadOutcome> {
  let args: unknown;
  try {
    args = entry.inputShape === null ? undefined : z.object(entry.inputShape).parse(input ?? {});
    entry.validateArgs({ args });
  } catch (error) {
    return { ok: false, failure: toolFailure({ text: describeInputError({ error }) }) };
  }

  if (THIRD_PARTY_READ_TOOLS.includes(entry.name)) {
    const taken = ctx.state.limits.take({ kind: 'thirdPartyReads' });
    if (!taken.ok) {
      await ctx.notice({ key: taken.noticeKey, params: { limit: taken.limit } });
      return { ok: false, failure: toolFailure({ text: taken.message }) };
    }
  }

  try {
    const result = await entry.invoke({ args, extra: await ctx.getExtra() });
    return { ok: true, fullText: compactJsonText({ text: result.content.map((block) => block.text).join('\n') }) };
  } catch (error) {
    return { ok: false, failure: toolFailure({ text: errorMessage({ error }) }) };
  }
}

/**
 * Runs a catalog read for the model. The whole result stays in the run for later analysis; the
 * model sees a capped copy, and the read becomes a source of every card the run proposes afterwards.
 */
export async function runCatalogRead({
  ctx,
  entry,
  input,
  callId,
}: {
  ctx: ChatToolContext;
  entry: ToolCatalogEntry;
  input: unknown;
  callId: string;
}): Promise<ChatToolResult> {
  const read = await readFromCatalog({ ctx, entry, input });
  if (!read.ok) return read.failure;

  const { fullText } = read;
  ctx.state.reads.set(callId, { callId, toolName: entry.name, args: input, fullText });
  ctx.state.sources.push({ type: 'toolCall', callId, toolName: entry.name, args: compactArgs({ args: input }) });

  const text = capForModel({ text: fullText });
  const wrapped = ctx.run.wrapUntrusted?.({ kind: 'toolResult', text }) ?? text;

  return toolSuccess({
    text: wrapped,
    summary: fullText,
  });
}
