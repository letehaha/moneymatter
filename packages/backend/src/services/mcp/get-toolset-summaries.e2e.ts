import { MCP_CLIENT_TOOL_CAP, MCP_OPTIONAL_TOOLSETS, mcpToolsetScope } from '@bt/shared/types';
import { API_RESPONSE_STATUS } from '@bt/shared/types/api';
import { describe, expect, it } from '@jest/globals';
import { CustomResponse } from '@tests/helpers';
import * as mcpHelpers from '@tests/helpers/mcp';

describe('GET /user/settings/mcp/toolsets', () => {
  it('returns core first without a scope, then every optional toolset with its scope', async () => {
    const { toolsets } = await mcpHelpers.getMcpToolsets({ raw: true });

    expect(toolsets.map((t) => t.id)).toEqual(['core', ...MCP_OPTIONAL_TOOLSETS]);
    expect(toolsets[0]!.scope).toBeNull();
    for (const toolset of toolsets.slice(1)) {
      expect(toolset.scope).toBe(mcpToolsetScope({ toolset: toolset.id as (typeof MCP_OPTIONAL_TOOLSETS)[number] }));
    }
  });

  it('counts the tools of every toolset, with core alone under the client tool cap', async () => {
    const { toolsets } = await mcpHelpers.getMcpToolsets({ raw: true });

    for (const toolset of toolsets) expect(toolset.toolCount).toBeGreaterThan(0);
    expect(toolsets[0]!.toolCount).toBeLessThan(MCP_CLIENT_TOOL_CAP);
    expect(toolsets.reduce((sum, t) => sum + t.toolCount, 0)).toBeGreaterThan(MCP_CLIENT_TOOL_CAP);
  });

  it('returns 401 when not authenticated', async () => {
    const savedCookies = global.APP_AUTH_COOKIES;
    global.APP_AUTH_COOKIES = '';

    const res: CustomResponse<unknown> = await mcpHelpers.getMcpToolsets({ raw: false });

    global.APP_AUTH_COOKIES = savedCookies;
    expect(res.statusCode).toBe(401);
    expect(res.body.status).toBe(API_RESPONSE_STATUS.error);
  });
});
