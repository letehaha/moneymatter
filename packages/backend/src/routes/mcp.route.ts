import { CustomError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { runWithBalanceRevalueBatch } from '@services/balances/revalue-balance-history.service';
import { McpAuthInfo, verifyMcpToken } from '@services/mcp/auth';
import { createMcpServer } from '@services/mcp/server';
import {
  getSession,
  registerSession,
  removeSession,
  startSessionCleanup,
  touchSession,
} from '@services/mcp/transport-manager';
import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { MCP_BASE_URL } from '../config';

const router = Router();

// Start the idle session cleanup interval (skip in tests to avoid open handles)
if (process.env.NODE_ENV !== 'test') {
  startSessionCleanup();
}

declare module 'express' {
  interface Request {
    auth?: McpAuthInfo;
    mcpAuthInfo?: McpAuthInfo;
  }
}

/**
 * Extract the MCP session ID from the request header, handling the string[] case.
 */
function getSessionId({ req }: { req: Request }): string | undefined {
  const header = req.headers['mcp-session-id'];
  return Array.isArray(header) ? header[0] : header;
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
 * Lookup an existing session transport by session ID from the request header.
 * Returns the transport if found, or sends a 400/403 error and returns null.
 */
function resolveSessionTransport({ req, res }: { req: Request; res: Response }): StreamableHTTPServerTransport | null {
  const sessionId = getSessionId({ req });

  if (!sessionId) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Missing session ID' },
      id: null,
    });
    return null;
  }

  const session = getSession({ sessionId });
  if (!session) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid or expired session ID' },
      id: null,
    });
    return null;
  }

  // Verify the session belongs to the authenticated user
  if (session.userId !== req.mcpAuthInfo?.extra?.userId) {
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Session does not belong to authenticated user' },
      id: null,
    });
    return null;
  }

  touchSession({ sessionId });
  return session.transport;
}

/**
 * POST /mcp — Handle MCP JSON-RPC requests (initialization + tool calls)
 */
// oxlint-disable-next-line oxc/no-async-endpoint-handlers -- handler has internal try/catch for all async operations
router.post('/', async (req: Request, res: Response) => {
  if (!(await authenticateMcpRequest({ req, res }))) return;

  const sessionId = getSessionId({ req });

  // Tool calls mutate data, so each request gets its own revalue scope: the queued
  // rebuilds must run after the tool's writes, not inline from inside a model hook.
  try {
    // Reuse existing transport for established sessions
    if (sessionId) {
      const transport = resolveSessionTransport({ req, res });
      if (!transport) return;

      await runWithBalanceRevalueBatch(() => transport.handleRequest(req, res, req.body));
      return;
    }

    // New session — must be an initialization request
    if (req.body?.method === 'initialize') {
      const userId = req.mcpAuthInfo!.extra.userId;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          registerSession({ sessionId: sid, transport, userId });
        },
      });

      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- StreamableHTTPServerTransport only exposes onclose setter
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) removeSession({ sessionId: sid });
      };

      const server = createMcpServer();
      await server.connect(transport);
      await runWithBalanceRevalueBatch(() => transport.handleRequest(req, res, req.body));
      return;
    }

    // Invalid request — no session and not initialization
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid request. Send an initialization request first.' },
      id: null,
    });
  } catch (error) {
    if (error instanceof CustomError && error.httpCode === 503) {
      if (!res.headersSent) {
        res.status(503).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: (error as Error).message },
          id: null,
        });
      }
      return;
    }
    handleMcpError({ error, res, label: 'POST' });
  }
});

/**
 * GET /mcp — SSE stream for server-to-client notifications
 */
// oxlint-disable-next-line oxc/no-async-endpoint-handlers -- handler has internal try/catch for all async operations
router.get('/', async (req: Request, res: Response) => {
  if (!(await authenticateMcpRequest({ req, res }))) return;

  const transport = resolveSessionTransport({ req, res });
  if (!transport) return;

  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    handleMcpError({ error, res, label: 'GET' });
  }
});

/**
 * DELETE /mcp — Terminate an MCP session
 */
// oxlint-disable-next-line oxc/no-async-endpoint-handlers -- handler has internal try/catch for all async operations
router.delete('/', async (req: Request, res: Response) => {
  if (!(await authenticateMcpRequest({ req, res }))) return;

  const sessionId = getSessionId({ req });

  const transport = resolveSessionTransport({ req, res });
  if (!transport) return;

  try {
    await transport.handleRequest(req, res);
    if (sessionId) removeSession({ sessionId });
  } catch (error) {
    if (sessionId) removeSession({ sessionId });
    handleMcpError({ error, res, label: 'DELETE' });
  }
});

export default router;
