import { buildMcpAuthInfo } from '../../mcp/auth';
import type { ToolInvokeExtra } from '../../mcp/tool-catalog';
import type { ChatToolkitRun } from './types';

/** The client id every chat call runs under, reads and approved writes alike. */
export const CHAT_CLIENT_ID = 'moneymatter-chat';

const buildChatExtra = async ({
  user,
  scopes,
}: {
  user: ChatToolkitRun['user'];
  scopes: string[];
}): Promise<ToolInvokeExtra> => ({
  authInfo: await buildMcpAuthInfo({
    user,
    clientId: CHAT_CLIENT_ID,
    scopes,
    // No bearer token exists for an in-process call; nothing reads this value.
    token: `${CHAT_CLIENT_ID}:in-process`,
  }),
});

/**
 * The `extra` a read runs with: the plan entitlements of the user, and only the `finance:read`
 * scope. If a write tool were ever classified as a read, its own `requireScope` would refuse it.
 */
export const buildChatReadExtra = ({ user }: { user: ChatToolkitRun['user'] }): Promise<ToolInvokeExtra> =>
  buildChatExtra({ user, scopes: ['finance:read'] });

/**
 * The `extra` an approved card runs its handler with: every scope an MCP client can hold and the
 * current entitlements, so `requireScope`, `requireFeatureAccess`, the base-currency lock and the
 * rate limits behave exactly as they do for a write that arrives through MCP.
 */
export const buildChatApplyExtra = ({ user }: { user: ChatToolkitRun['user'] }): Promise<ToolInvokeExtra> =>
  buildChatExtra({ user, scopes: ['finance:read', 'finance:write', 'finance:delete'] });
