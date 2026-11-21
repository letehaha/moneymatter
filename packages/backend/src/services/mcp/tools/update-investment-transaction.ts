import { recordId } from '@common/lib/zod/custom-types';
import { updateInvestmentTransactionBodyShape } from '@controllers/investments/transactions/schemas';
import { updateInvestmentTransaction } from '@services/investments/transactions/update.service';

const shape = updateInvestmentTransactionBodyShape;

import { defineTool } from '../define-tool';

export const updateInvestmentTransactionTool = defineTool({
  name: 'update_investment_transaction',
  toolset: 'investments',
  access: 'write',
  description:
    'Update an existing investment transaction — correct the date, quantity, price, fees, settlement leg, category, or label. Obtain the transactionId from get_investment_transactions. Only provided fields are changed; the holding recalculation runs automatically after every update.',
  input: {
    transactionId: recordId().describe('Investment transaction ID (from get_investment_transactions)'),
    category: shape.category.describe('New transaction category'),
    date: shape.date.describe(
      'When the trade occurred. Accepts a date-only value (ISO 8601, e.g. "2024-03-15") or a full datetime (e.g. "2024-03-15T09:30:00.000Z"); date-only is stored at UTC midnight.',
    ),
    quantity: shape.quantity.describe('New share quantity as a positive decimal string'),
    price: shape.price.describe('New price per share as a decimal string (0 allowed)'),
    fees: shape.fees.describe('New fees/commissions as a decimal string (0 allowed)'),
    name: shape.name.describe('New label or note'),
    settlementCurrencyCode: shape.settlementCurrencyCode.describe('New currency of the cash that actually moved'),
    settlementAmount: shape.settlementAmount.describe(
      'New cash that moved, in the settlement currency (decimal string)',
    ),
    settlementFees: shape.settlementFees.describe(
      'New fees in the settlement currency. Not together with settlementRate',
    ),
    settlementRate: shape.settlementRate.describe(
      'Known security-to-settlement rate; the fee is derived as the residual. Not together with settlementFees',
    ),
  },
  run: ({ userId, args }) => {
    const { transactionId, ...fields } = args;
    return updateInvestmentTransaction({ userId, transactionId, ...fields });
  },
});
