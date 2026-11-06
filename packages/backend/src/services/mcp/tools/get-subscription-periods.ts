import { recordId } from '@common/lib/zod/custom-types';
import { getPeriodsQuerySchema } from '@controllers/subscriptions/shared-schemas';
import { getPeriods } from '@services/subscriptions/get-periods';

import { defineTool } from '../define-tool';

export const getSubscriptionPeriodsTool = defineTool({
  name: 'get_subscription_periods',
  toolset: 'subscriptions',
  access: 'read',
  description:
    'List a subscription’s billing periods, newest due date first, with the status of each (upcoming, overdue, paid, skipped) and the transaction behind a paid one. Returns { periods, total }. Use the period ids with pay_subscription_period, skip_subscription_period, unlink_subscription_period_transaction and revert_subscription_period.',
  input: {
    subscriptionId: recordId().describe('ID of the subscription'),
    limit: getPeriodsQuerySchema.shape.limit.describe('Periods per page, 1 to 50. Default 6'),
    offset: getPeriodsQuerySchema.shape.offset.describe('Periods to skip, for the next page. Default 0'),
  },
  run: ({ userId, args }) =>
    getPeriods({
      userId,
      subscriptionId: args.subscriptionId,
      limit: args.limit,
      offset: args.offset,
    }),
});
