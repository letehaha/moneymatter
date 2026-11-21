import { recordId } from '@common/lib/zod/custom-types';
import { dismissTransferSuggestion } from '@services/transactions/transactions-linking/dismiss-transfer-suggestion.service';
import { dismissBodySchema } from '@services/transactions/transactions-linking/recommendation-schemas';

import { defineTool } from '../define-tool';

export const dismissTransferSuggestionTool = defineTool({
  name: 'dismiss_transfer_suggestion',
  toolset: 'review',
  access: 'write',
  description:
    "Tell MoneyMatter that a suggested expense/income pair is not a transfer, so list_transfer_suggestions stops offering that pair. Both transactions must be the caller's. Nothing is linked or deleted, and dismissing the same pair twice is harmless.",
  input: {
    expenseTransactionId: recordId().describe('The expense of the suggested pair'),
    incomeTransactionId: recordId().describe('The income of the suggested pair'),
  },
  run: async ({ userId, args }) => {
    const body = dismissBodySchema.parse(args);
    await dismissTransferSuggestion({ userId, ...body });

    return { dismissed: true, ...body };
  },
});
