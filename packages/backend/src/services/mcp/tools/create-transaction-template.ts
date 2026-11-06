import { templateBodySchema } from '@controllers/transaction-templates/schema';
import { createTransactionTemplate } from '@services/transaction-templates';

import { defineTool } from '../define-tool';
import { presentTemplate } from './template-output';

const shape = templateBodySchema.shape;

export const createTransactionTemplateTool = defineTool({
  name: 'create_transaction_template',
  toolset: 'groups-templates',
  access: 'write',
  description:
    'Create a transaction template: a named preset to fill new transactions from. Only name and transactionType are required. A pinned amount needs accountId, because it is stored in that account\'s currency. The name must be unique: a duplicate is refused with "already exists". Every id must belong to the user. Returns the template.',
  input: {
    name: shape.name.describe(
      'Template name, 1 to 100 characters. Unique per user, ignoring case and surrounding spaces.',
    ),
    transactionType: shape.transactionType.describe('"income" or "expense".'),
    amount: shape.amount.describe(
      'Pinned amount, 0 or more, in the currency of accountId. Needs accountId. Omit or null for none.',
    ),
    accountId: shape.accountId.describe(
      'Account the template posts to. Must be an active account that is not bank-connected.',
    ),
    categoryId: shape.categoryId.describe('Category id (from get_categories).'),
    payeeId: shape.payeeId.describe('Payee id (from get_payees).'),
    paymentType: shape.paymentType.describe('Payment type.'),
    note: shape.note.describe('Note, up to 1000 characters.'),
    originalCurrencyCode: shape.originalCurrencyCode.describe(
      'Original currency code, for a template written in another currency.',
    ),
    tagIds: shape.tagIds.describe('Tag ids (from get_tags), unique.'),
  },
  run: async ({ userId, args }) => {
    const template = await createTransactionTemplate({ userId, ...args });
    return presentTemplate({ template });
  },
});
