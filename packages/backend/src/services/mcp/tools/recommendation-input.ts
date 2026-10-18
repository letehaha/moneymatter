import { TRANSACTION_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { z } from 'zod';

// Restates the REST query fields: that schema coerces `originAmount` from a query string, which a
// published schema cannot describe. The handler validates with the REST schema, and a unit test
// keeps the two key sets equal.
export const recommendationInput = {
  transactionId: recordId()
    .optional()
    .describe('A saved transaction to find candidates for. Give this, or transactionType + originAmount + accountId'),
  transactionType: z
    .nativeEnum(TRANSACTION_TYPES)
    .optional()
    .describe('For a transaction that is not saved yet: its type. Needs originAmount and accountId'),
  originAmount: z
    .number()
    .positive()
    .optional()
    .describe('For a transaction that is not saved yet: its amount, a positive decimal in the account currency'),
  accountId: recordId().optional().describe('For a transaction that is not saved yet: its account'),
};
