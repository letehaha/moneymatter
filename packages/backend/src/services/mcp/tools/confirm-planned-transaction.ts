import { recordId } from '@common/lib/zod/custom-types';
import { transactionTimeSchema } from '@controllers/transactions.controller/schemas';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTransactionTuple } from '@root/serializers/transactions.serializer';
import { getTransactionById } from '@services/transactions/get-by-id';
import { updateTransaction } from '@services/transactions/update-transaction';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentTransactions } from './transaction-output';

const inputSchema = {
  transactionId: recordId().describe('ID of the planned transaction to confirm'),
  time: transactionTimeSchema()
    .optional()
    .describe(
      "When the money actually moved (ISO 8601). Default: the plan's own date, or now when the plan is still in the future",
    ),
};

export function registerConfirmPlannedTransaction(server: McpServer) {
  server.registerTool(
    'confirm_planned_transaction',
    {
      description:
        'Confirm a planned (upcoming) transaction once the money has moved: it becomes a real transaction and counts toward the account balance. A plan still dated in the future is moved to now unless time is given. Confirming settles the linked subscription period, if any. Plans on bank-connected accounts cannot be confirmed here: the bank sync confirms them. Find plans with search_transactions (isPlanned true) or get_planned_summary.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'confirm_planned_transaction', clientId: extra.authInfo?.clientId });

      const fetched = await getTransactionById({ id: args.transactionId, userId });
      if (!fetched) throw new NotFoundError({ message: t({ key: 'transactions.transactionIdNotExist' }) });
      if (!fetched.tx.isPlanned) {
        throw new ValidationError({ message: 'This is not a planned transaction, so there is nothing to confirm' });
      }

      // A confirmed plan is money that already moved, so a still-future date comes back to now,
      // as the web app does.
      const now = new Date();
      const time = args.time ? new Date(args.time) : fetched.tx.time > now ? now : undefined;

      // The same update `PUT /transactions/:id` runs for `{ isPlanned: false }`, so the service's
      // bank-account refusal and the subscription-period settlement apply here too.
      const result = await updateTransaction({
        id: args.transactionId,
        userId,
        isPlanned: false,
        ...(time && { time }),
      });

      // [base, opposite?]: the opposite leg exists for a transfer.
      const confirmed = serializeTransactionTuple(result).filter((tx) => tx !== undefined);
      return jsonContent({ data: await presentTransactions({ userId, transactions: confirmed }) });
    },
  );
}
