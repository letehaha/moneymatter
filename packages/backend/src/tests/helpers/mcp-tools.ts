import { type Feature, USER_ROLES } from '@bt/shared/types';
import { jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as entitlementsService from '@services/entitlements/resolve-entitlements.service';
import { registerDefinedTool, type ToolDef } from '@services/mcp/define-tool';
import type { z } from 'zod';

/**
 * Unit-test helpers for MCP tools. A separate module from `tests/helpers/mcp.ts` on purpose:
 * that one imports the app, supertest and the auth pool, which a unit test must not load.
 */

export interface McpExtra {
  authInfo: {
    clientId?: string;
    scopes: string[];
    extra: { userId: number; role: string; readOnly: boolean; features: Feature[] };
  };
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
}

/** Tools with an input take `(args, extra)`; tools without one take `(extra)`. */
export type ToolHandler = (...params: [args: unknown, extra: McpExtra] | [extra: McpExtra]) => Promise<ToolResult>;

export interface CapturedTool {
  name: string;
  config: {
    description?: string;
    inputSchema?: z.ZodObject;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  };
  handler: ToolHandler;
}

/**
 * `requireFeature` reads the plan from the entitlements service, so each call answers with the
 * features its `extra` carries, the way the live token carries the user's plan.
 */
function withPlanOfExtra({ handler }: { handler: ToolHandler }): ToolHandler {
  return (...params) => {
    const extra = params[params.length - 1] as McpExtra;
    jest.spyOn(entitlementsService, 'getEntitlementsByUserId').mockResolvedValue({
      readOnly: extra.authInfo.extra.readOnly,
      features: extra.authInfo.extra.features,
    } as never);
    return handler(...params);
  };
}

/** Registers the tool def(s) against a fake server; its handlers parse args with the input schema, as the SDK does. */
export function captureTools({ register }: { register: ToolDef | ToolDef[] }): CapturedTool[] {
  const tools: CapturedTool[] = [];
  const server = {
    registerTool: (name: string, config: CapturedTool['config'], handler: ToolHandler) => {
      const parsed: ToolHandler = async (...params) =>
        config.inputSchema
          ? handler(
              config.inputSchema.parse(params.length > 1 ? (params[0] ?? {}) : {}),
              params[params.length - 1] as McpExtra,
            )
          : handler(...params);
      tools.push({ name, config, handler: withPlanOfExtra({ handler: parsed }) });
    },
  } as unknown as McpServer;

  for (const def of Array.isArray(register) ? register : [register]) registerDefinedTool({ server, def });
  return tools;
}

/** The `extra` the MCP SDK hands a tool handler, as `getUserId`, `requireScope` read it; `features` is the plan `requireFeature` sees. */
export function makeExtra({
  userId = 42,
  scopes = ['finance:read', 'finance:write', 'finance:delete'],
  readOnly = false,
  role = USER_ROLES.common,
  features = [],
}: {
  userId?: number;
  scopes?: string[];
  readOnly?: boolean;
  role?: string;
  features?: Feature[];
} = {}): McpExtra {
  return { authInfo: { scopes, extra: { userId, role, readOnly, features } } };
}

/** The tool's JSON payload, parsed. */
export function parseToolResult({ result }: { result: ToolResult }): unknown {
  return JSON.parse(result.content[0]!.text);
}
