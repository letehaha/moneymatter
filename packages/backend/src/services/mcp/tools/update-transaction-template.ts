import { recordId } from '@common/lib/zod/custom-types';
import { updateTemplateBodySchema } from '@controllers/transaction-templates/schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateTransactionTemplate } from '@services/transaction-templates';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentTemplate } from './template-output';

const shape = updateTemplateBodySchema.shape;

const inputSchema = {
  templateId: recordId().describe('Template id (from get_transaction_templates).'),
  name: shape.name.describe('New name, 1 to 100 characters, unique per user.'),
  transactionType: shape.transactionType.describe('"income" or "expense".'),
  amount: shape.amount.describe('Pinned amount, 0 or more, in the currency of the account. null clears it.'),
  accountId: shape.accountId.describe('Account the template posts to. null clears it (and the pinned amount with it).'),
  categoryId: shape.categoryId.describe('Category id. null clears it.'),
  payeeId: shape.payeeId.describe('Payee id. null clears it.'),
  paymentType: shape.paymentType.describe('Payment type. null clears it.'),
  note: shape.note.describe('Note, up to 1000 characters. null clears it.'),
  originalCurrencyCode: shape.originalCurrencyCode.describe('Original currency code. null clears it.'),
  tagIds: shape.tagIds.describe('Tag ids. Replaces the whole tag set; [] removes every tag.'),
};

export function registerUpdateTransactionTemplate(server: McpServer) {
  server.registerTool(
    'update_transaction_template',
    {
      description:
        'Update a transaction template. Send templateId plus only the fields to change: an omitted field stays as it is, null clears a nullable field, and tagIds replaces the whole tag set. A pinned amount needs an account, so clear the amount together with the account. Returns the template. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_transaction_template', clientId: extra.authInfo?.clientId });

      const { templateId, ...body } = args;
      const template = await updateTransactionTemplate({ userId, id: templateId, ...body });
      return jsonContent({ data: presentTemplate({ template }) });
    },
  );
}
