import type { Feature, McpToolset } from '@bt/shared/types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeature, requireScope } from './tools/helpers';

export type ToolAccess = 'read' | 'write' | 'delete';
export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape, Args = z.infer<z.ZodObject<Shape>>> {
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
  /**
   * Every check of the arguments the input shape cannot express (a shared body schema, a rule
   * across fields, a refusal), returning what `run` receives. Pure: no guards and no I/O; it
   * throws on a bad input. The chat runs it on a proposed call before the user approves it, so a
   * card is refused the way the tool refuses the call. Without it `run` gets the arguments as
   * the input shape parsed them.
   */
  validate?(params: { args: z.infer<z.ZodObject<Shape>> }): Args;
  // Method syntax keeps `validate` and `run` bivariant, so a def with a concrete shape fits in a `ToolDef[]`.
  run(params: { userId: number; args: Args; extra: ToolExtra }): unknown;
}

export function defineTool<Shape extends z.ZodRawShape = Record<never, never>, Args = z.infer<z.ZodObject<Shape>>>(
  def: ToolDef<Shape, Args>,
): ToolDef<Shape, Args> {
  return def;
}

/** The arguments `run` receives: what `validate` returns, or the arguments as given. */
export function validateToolArgs({ def, args }: { def: ToolDef; args: unknown }): z.infer<z.ZodObject> {
  const given = args as z.infer<z.ZodObject>;
  return def.validate ? def.validate({ args: given }) : given;
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

/**
 * Runs a tool the way the MCP server does: the guards (auth, scope, feature, base-currency lock),
 * then `validate`, then `run`, with the result wrapped as MCP content. The MCP handler and the
 * chat's tool catalog both call it, so a tool behaves the same on either path.
 */
export async function invokeDefinedTool({ def, args, extra }: { def: ToolDef; args: unknown; extra: ToolExtra }) {
  const userId = getUserId({ extra });
  if (def.access !== 'read') requireScope({ extra, scope: `finance:${def.access}` });
  if (def.feature) await requireFeature({ userId, feature: def.feature });
  if (def.lock ?? def.access !== 'read') await assertBaseCurrencyUnlocked({ userId });
  trackMcpToolUsed({ userId, tool: def.name, clientId: extra.authInfo?.clientId });

  return jsonContent({ data: await def.run({ userId, args: validateToolArgs({ def, args }), extra }) });
}

export function registerDefinedTool({ server, def }: { server: McpServer; def: ToolDef }): void {
  // The SDK calls a tool that has no input schema as `(extra)`, and one that has it as `(args, extra)`.
  const handler = (...params: [unknown, ToolExtra] | [ToolExtra]) =>
    invokeDefinedTool({
      def,
      args: params.length > 1 ? params[0] : {},
      extra: params[params.length - 1] as ToolExtra,
    });

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
