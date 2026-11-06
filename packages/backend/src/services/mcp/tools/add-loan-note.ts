import { recordId } from '@common/lib/zod/custom-types';
import { toLoanView } from '@services/loans/get-loan-views.service';
import { updateLoan } from '@services/loans/update-loan.service';
import { loanNoteEventSchema } from '@services/loans/zod-schemas';

import { defineTool } from '../define-tool';
import { presentLoan } from './loan-output';

export const addLoanNoteTool = defineTool({
  name: 'add_loan_note',
  toolset: 'loans-vehicles',
  access: 'write',
  description:
    'Add a note to the timeline of a loan (for example "rate fixed until 2030"). Notes cannot be edited or removed. Returns the loan with its timeline.',
  input: {
    loanId: recordId().describe('ID of the loan (from get_loans)'),
    text: loanNoteEventSchema.shape.text.describe('The note, 1 to 2000 characters'),
  },
  run: async ({ userId, args }) => {
    const loanDetails = await updateLoan({ userId, accountId: args.loanId, appendNote: args.text });

    const loan = await toLoanView({ userId, loanDetails });
    return presentLoan({ loan });
  },
});
