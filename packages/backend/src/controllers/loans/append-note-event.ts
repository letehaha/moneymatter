import { createController } from '@controllers/helpers/controller-factory';
import { toLoanView } from '@services/loans/get-loan-views.service';
import { updateLoan } from '@services/loans/update-loan.service';
import { loanIdParamsSchema, loanNoteEventSchema } from '@services/loans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: loanIdParamsSchema,
  body: loanNoteEventSchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const loanDetails = await updateLoan({
    userId: user.id,
    accountId: params.id,
    appendNote: body.text,
  });

  return { data: await toLoanView({ userId: user.id, loanDetails }), statusCode: 201 };
});
