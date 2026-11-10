import { mcpToolsetsFromScopes } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { runWithBalanceRevalueBatch } from '@services/balances/revalue-balance-history.service';
import { McpAuthInfo, verifyMcpToken } from '@services/mcp/auth';
import { createMcpServer } from '@services/mcp/server';
import { Router, Request, Response } from 'express';

import { MCP_BASE_URL } from '../config';

const router = Router();

declare module 'express' {
  interface Request {
    auth?: McpAuthInfo;
    mcpAuthInfo?: McpAuthInfo;
  }
}

/**
 * Shared error handler for MCP route catch blocks.
 */
function handleMcpError({ error, res, label }: { error: unknown; res: Response; label: string }) {
  logger.error(`MCP ${label} handler error`, { error: (error as Error).message });
  if (!res.headersSent) {
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal server error' },
      id: null,
    });
  }
}

/**
 * Authenticate MCP requests via OAuth bearer token.
 * Returns 401 if the token is missing, invalid, or expired, and 403 if it lacks `finance:read`.
 */
async function authenticateMcpRequest({ req, res }: { req: Request; res: Response }): Promise<boolean> {
  const resourceMetadataUrl = `${MCP_BASE_URL}/.well-known/oauth-protected-resource`;

  let authInfo: McpAuthInfo;
  try {
    authInfo = await verifyMcpToken({
      authorizationHeader: req.headers.authorization,
    });
  } catch {
    res
      .status(401)
      .set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`)
      .json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null,
      });
    return false;
  }

  // Read tools do not check scopes themselves, so this is the only gate keeping a
  // token without `finance:read` away from them.
  if (!authInfo.scopes.includes('finance:read')) {
    logger.info('MCP request rejected: token lacks finance:read', {
      clientId: authInfo.clientId,
      scopes: authInfo.scopes,
    });
    // The challenge repeats the granted scopes: a client that re-authorizes with
    // exactly the challenged list would otherwise lose them.
    const challengeScope = ['finance:read', ...authInfo.scopes].join(' ');
    res
      .status(403)
      .set(
        'WWW-Authenticate',
        `Bearer error="insufficient_scope", scope="${challengeScope}", resource_metadata="${resourceMetadataUrl}"`,
      )
      .json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Missing required scope: finance:read. Re-connect the app and grant it.' },
        id: null,
      });
    return false;
  }

  req.mcpAuthInfo = authInfo;
  // Set req.auth so the MCP SDK passes authInfo to tool handlers via extra.authInfo
  req.auth = authInfo;
  return true;
}

/**
 * POST /mcp — Handle MCP JSON-RPC requests, in the Streamable HTTP spec's stateless mode.
 *
 * Every request gets a server and transport of its own and nothing outlives it. A tool call needs only
 * its request's token, so an idle client or a backend restart has no session to lose, and a session id
 * a client still sends is ignored. The toolsets come from the request's token, so the ones picked on
 * the consent screen apply from the next call. Building the server registers its tools, about a
 * millisecond.
 */
// oxlint-disable-next-line oxc/no-async-endpoint-handlers -- handler has internal try/catch for all async operations
router.post('/', async (req: Request, res: Response) => {
  if (!(await authenticateMcpRequest({ req, res }))) return;

  try {
    const server = createMcpServer({ toolsets: mcpToolsetsFromScopes({ scopes: req.mcpAuthInfo!.scopes }) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      server.close().catch((error: unknown) => {
        logger.error('MCP server close failed', { error: (error as Error).message });
      });
    });

    await server.connect(transport);
    // Tool calls mutate data, so each request gets its own revalue scope: the queued
    // rebuilds must run after the tool's writes, not inline from inside a model hook.
    await runWithBalanceRevalueBatch(() => transport.handleRequest(req, res, req.body));
  } catch (error) {
    handleMcpError({ error, res, label: 'POST' });
  }
});

/**
 * GET and DELETE /mcp answer 405: there is no stream to open, since nothing is ever pushed to a
 * client, and no session to end. Both still authenticate first, so the scope gate answers the same on
 * every method.
 */
const methodNotAllowed = async (req: Request, res: Response) => {
  try {
    if (!(await authenticateMcpRequest({ req, res }))) return;

    res
      .status(405)
      .set('Allow', 'POST')
      .json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed: this server keeps no sessions or streams.' },
        id: null,
      });
  } catch (error) {
    handleMcpError({ error, res, label: req.method });
  }
};

// oxlint-disable-next-line oxc/no-async-endpoint-handlers -- handler has internal try/catch for all async operations
router.get('/', methodNotAllowed);
// oxlint-disable-next-line oxc/no-async-endpoint-handlers -- handler has internal try/catch for all async operations
router.delete('/', methodNotAllowed);

export default router;
