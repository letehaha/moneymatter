import type { Feature, McpToolset } from '@bt/shared/types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeature, requireScope } from './tools/helpers';

export type ToolAccess = 'read' | 'write' | 'delete';
export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  toolset: McpToolset;
  access: ToolAccess;
  /** Base-currency lock check; defaults to `access !== 'read'`. */
  lock?: boolean;
  feature?: Feature;
  /** A write tool that also needs finance:delete on one path names it, e.g. 'with force'. */
  conditionalDelete?: string;
  /** Without the "Requires finance:X scope." sentence: `registerDefinedTool` appends it from `access`. */
  description: string;
  input?: Shape;
  // Method syntax keeps `run` bivariant, so a def with a concrete shape fits in a `ToolDef[]`.
  run(params: { userId: number; args: z.infer<z.ZodObject<Shape>>; extra: ToolExtra }): unknown;
}

export function defineTool<Shape extends z.ZodRawShape = Record<never, never>>(def: ToolDef<Shape>): ToolDef<Shape> {
  return def;
}

export function scopeSentence({ def }: { def: ToolDef }): string {
  if (def.access === 'read') return '';
  const conditional = def.conditionalDelete ? `, and finance:delete scope ${def.conditionalDelete}` : '';
  return ` Requires finance:${def.access} scope${conditional}.`;
}

// Every `/mcp` request registers its tools again, so the strict object is built once per def.
const inputSchemas = new WeakMap<ToolDef, z.ZodObject>();

function inputSchemaOf({ def }: { def: ToolDef }): z.ZodObject | undefined {
  if (!def.input) return undefined;
  let schema = inputSchemas.get(def);
  if (!schema) {
    schema = z.strictObject(def.input);
    inputSchemas.set(def, schema);
  }
  return schema;
}

export function registerDefinedTool({ server, def }: { server: McpServer; def: ToolDef }): void {
  const lock = def.lock ?? def.access !== 'read';

  // The SDK calls a tool that has no input schema as `(extra)`, and one that has it as `(args, extra)`.
  const handler = async (...params: [unknown, ToolExtra] | [ToolExtra]) => {
    const extra = params[params.length - 1] as ToolExtra;
    const args = (params.length > 1 ? params[0] : {}) as z.infer<z.ZodObject>;

    const userId = getUserId({ extra });
    if (def.access !== 'read') requireScope({ extra, scope: `finance:${def.access}` });
    if (def.feature) await requireFeature({ userId, feature: def.feature });
    if (lock) await assertBaseCurrencyUnlocked({ userId });
    trackMcpToolUsed({ userId, tool: def.name, clientId: extra.authInfo?.clientId });

    return jsonContent({ data: await def.run({ userId, args, extra }) });
  };

  server.registerTool(
    def.name,
    {
      description: def.description + scopeSentence({ def }),
      inputSchema: inputSchemaOf({ def }),
      // Write tools leave destructiveHint unset: the spec default is destructive, and updates overwrite.
      annotations: { readOnlyHint: def.access === 'read', ...(def.access === 'delete' && { destructiveHint: true }) },
    },
    handler as never,
  );
}
