import { recordId } from '@common/lib/zod/custom-types';
import { deleteLoan } from '@services/loans/delete-loan.service';

import { defineTool } from '../define-tool';

export const deleteLoanTool = defineTool({
  name: 'delete_loan',
  toolset: 'loans-vehicles',
  access: 'delete',
  description:
    'Permanently delete a loan and its account. A loan with recorded payments is refused (get_loans shows paymentsCount): unlink the payments first with unlink_loan_payment. This action is irreversible: confirm with the user before calling.',
  input: {
    loanId: recordId().describe('ID of the loan to delete (from get_loans)'),
  },
  run: async ({ userId, args }) => {
    await deleteLoan({ userId, accountId: args.loanId });

    return { deleted: true, id: args.loanId };
  },
});
