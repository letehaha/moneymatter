import { recordId } from '@common/lib/zod/custom-types';
import { deleteTransactionTemplate } from '@services/transaction-templates';

import { defineTool } from '../define-tool';

export const deleteTransactionTemplateTool = defineTool({
  name: 'delete_transaction_template',
  toolset: 'groups-templates',
  access: 'delete',
  description:
    'Permanently delete a transaction template. Transactions already created from it are not affected. Only call when the user explicitly confirms deletion.',
  input: {
    templateId: recordId().describe('Template id (from get_transaction_templates).'),
  },
  run: async ({ userId, args }) => {
    await deleteTransactionTemplate({ id: args.templateId, userId });
    return { deleted: true, templateId: args.templateId };
  },
});
