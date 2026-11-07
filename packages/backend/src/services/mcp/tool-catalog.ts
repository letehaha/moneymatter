import type { McpToolset } from '@bt/shared/types';
import type { z } from 'zod';

import type { McpAuthInfo } from './auth';
import {
  invokeDefinedTool,
  scopeSentence,
  type ToolAccess,
  type ToolDef,
  type ToolExtra,
  validateToolArgs,
} from './define-tool';
import { ALL_TOOLS } from './toolsets';

/** What a tool reads from the MCP SDK's `extra`: only the auth info. */
export interface ToolInvokeExtra {
  authInfo: McpAuthInfo;
}

export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
}

export interface ToolCatalogEntry {
  name: string;
  toolset: McpToolset;
  access: ToolAccess;
  /** The description the MCP client sees, scope sentence included. */
  description: string;
  /** The tool's input as a plain zod shape, or `null` for a tool without input. */
  inputShape: z.ZodRawShape | null;
  /**
   * Runs the tool as the MCP server does: its guards (scope, feature, base-currency lock), then
   * `validate`, then `run`. The caller owns the guards' input, `extra`.
   */
  invoke: (params: { args?: unknown; extra: ToolInvokeExtra }) => Promise<ToolCallResult>;
  /**
   * The tool's `validate`, with no guard and no I/O: it throws the tool's own error on a bad input
   * and does nothing for a tool without one. The caller runs it on args the `inputShape` accepted.
   */
  validateArgs: (params: { args: unknown }) => void;
}

function buildEntry({ def }: { def: ToolDef }): ToolCatalogEntry {
  return Object.freeze({
    name: def.name,
    toolset: def.toolset,
    access: def.access,
    description: def.description + scopeSentence({ def }),
    inputShape: def.input ?? null,
    invoke: ({ args, extra }: { args?: unknown; extra: ToolInvokeExtra }) =>
      invokeDefinedTool({ def, args: args ?? {}, extra: extra as unknown as ToolExtra }) as Promise<ToolCallResult>,
    validateArgs: ({ args }: { args: unknown }) => {
      validateToolArgs({ def, args });
    },
  });
}

let catalog: readonly ToolCatalogEntry[] | null = null;

/**
 * Every MCP tool of every toolset, built once from the tool defs, so the in-app chat calls the
 * tools the MCP server registers and a new tool needs no second registration.
 */
export function getToolCatalog(): readonly ToolCatalogEntry[] {
  catalog ??= Object.freeze(ALL_TOOLS.map((def) => buildEntry({ def })));
  return catalog;
}

let entriesByName: Map<string, ToolCatalogEntry> | null = null;

/** The catalog entry of a tool by name; `undefined` for a name the catalog does not know. */
export function findToolCatalogEntry({ name }: { name: string }): ToolCatalogEntry | undefined {
  entriesByName ??= new Map(getToolCatalog().map((entry) => [entry.name, entry]));
  return entriesByName.get(name);
}
