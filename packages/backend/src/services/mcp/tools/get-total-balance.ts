import { getBaseCurrency } from '@models/users-currencies.model';
import { getTotalBalanceReport } from '@services/stats/reports/total-balance.report';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getTotalBalanceTool = defineTool({
  name: 'get_total_balance',
  toolset: 'core',
  access: 'read',
  description:
    "Get the user's total balance across all accounts on one date, as { amount, currencyCode, date }, where amount is a number in the base currency and currencyCode is that currency. Subtracts credit limits when the user's includeCreditLimitInStats setting is on. For a series over time use get_balance_history.",
  input: {
    date: z.string().describe('Date to total the balance on (YYYY-MM-DD)'),
  },
  run: async ({ userId, args }) => {
    // The report resolves the base currency first and refuses a user without one, so the lookup below finds it.
    const amount = await getTotalBalanceReport({ userId, date: args.date });
    const baseCurrency = await getBaseCurrency({ userId });

    return { amount, currencyCode: baseCurrency.currencyCode, date: args.date };
  },
});
