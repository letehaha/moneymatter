import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toLoanView } from '@services/loans/get-loan-views.service';
import { updateLoan } from '@services/loans/update-loan.service';
import { loanNoteEventSchema } from '@services/loans/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentLoan } from './loan-output';

const inputSchema = {
  loanId: recordId().describe('ID of the loan (from get_loans)'),
  text: loanNoteEventSchema.shape.text.describe('The note, 1 to 2000 characters'),
};

export function registerAddLoanNote(server: McpServer) {
  server.registerTool(
    'add_loan_note',
    {
      description:
        'Add a note to the timeline of a loan (for example "rate fixed until 2030"). Notes cannot be edited or removed. Returns the loan with its timeline. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'add_loan_note', clientId: extra.authInfo?.clientId });

      const loanDetails = await updateLoan({ userId, accountId: args.loanId, appendNote: args.text });

      const loan = await toLoanView({ userId, loanDetails });
      return jsonContent({ data: presentLoan({ loan }) });
    },
  );
}
