import { recordId } from '@common/lib/zod/custom-types';
import { revertPeriod } from '@services/subscriptions/revert-period';

import { defineTool } from '../define-tool';
import { requireScope } from './helpers';

export const revertSubscriptionPeriodTool = defineTool({
  name: 'revert_subscription_period',
  toolset: 'subscriptions',
  access: 'write',
  conditionalDelete: 'when it deletes the transaction the app created',
  description:
    'Undo a paid or skipped period: it becomes upcoming (or overdue when its due date has passed) again, and the open period the app generated after it is removed unless a later period was already paid or skipped. When the payment transaction was created by the app for the period (pay_subscription_period with createTransaction), the revert also deletes that transaction and reverses its effect on the account balance, which additionally needs finance:delete scope; the call is refused, with nothing changed, when the token lacks it. A transaction you linked yourself is never deleted, and neither is a booked (non-planned) one on a bank-connected account. Returns the period.',
  input: {
    subscriptionId: recordId().describe('ID of the subscription'),
    periodId: recordId().describe('ID of the paid or skipped period to re-open'),
  },
  run: ({ userId, args, extra }) =>
    // The service asks right before it deletes the payment transaction, inside its own
    // transaction, so the answer reflects the state the delete runs on. A revert that keeps the
    // transaction never asks, and a write-only token still works for it.
    revertPeriod({
      userId,
      subscriptionId: args.subscriptionId,
      periodId: args.periodId,
      assertCanDeleteTransaction: () => requireScope({ extra, scope: 'finance:delete' }),
    }),
});
