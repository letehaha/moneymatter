import { recordId } from '@common/lib/zod/custom-types';
import { NotFoundError } from '@js/errors';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTransactionPortfolioLink } from '@services/investments/portfolios/transfers';
import { getTransactionVentureLink } from '@services/venture/linking/get-transaction-venture-link.service';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  transactionId: recordId().describe('ID of the transaction'),
};

/** The two link services answer "no link" with a not-found error; anything else is a real failure. */
const orNull = async <T>({ read }: { read: () => Promise<T> }): Promise<T | null> => {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
};

export function registerGetTransactionLinks(server: McpServer) {
  server.registerTool(
    'get_transaction_links',
    {
      description:
        'Read what a transaction is linked to: the portfolio transfer it funds or pays out (portfolioLink: portfolio, deposit or withdrawal, amount) and the venture event it belongs to (ventureLink: deal). Each is null when the transaction has no such link.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_transaction_links', clientId: extra.authInfo?.clientId });

      const [portfolioLink, ventureLink] = await Promise.all([
        orNull({ read: () => getTransactionPortfolioLink({ userId, transactionId: args.transactionId }) }),
        orNull({ read: () => getTransactionVentureLink({ userId, transactionId: args.transactionId }) }),
      ]);

      return jsonContent({ data: { portfolioLink, ventureLink } });
    },
  );
}
