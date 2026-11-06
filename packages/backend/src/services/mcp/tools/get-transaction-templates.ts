import { getTransactionTemplates } from '@services/transaction-templates';

import { defineTool } from '../define-tool';
import { presentTemplate } from './template-output';

export const getTransactionTemplatesTool = defineTool({
  name: 'get_transaction_templates',
  toolset: 'groups-templates',
  access: 'read',
  description:
    'List the transaction templates: named presets the user fills a new transaction from (type, and optionally an account, a pinned amount, a category, a payee, a payment type, a note, an original currency and tags). A template is not a transaction and not a recurring rule. To record a transaction from one, read its fields and call create_transaction. Oldest first.',
  run: async ({ userId }) => {
    const templates = await getTransactionTemplates({ userId });
    return templates.map((template) => presentTemplate({ template }));
  },
});
