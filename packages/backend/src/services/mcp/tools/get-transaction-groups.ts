import { recordId } from '@common/lib/zod/custom-types';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { getTransactionGroupById, getTransactionGroups } from '@services/transaction-groups';
import type {
  TransactionGroupWithAggregates,
  TransactionGroupWithTransactions,
} from '@services/transaction-groups/get-transaction-groups';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { presentTransactions } from './transaction-output';

export const getTransactionGroupsTool = defineTool({
  name: 'get_transaction_groups',
  toolset: 'groups-templates',
  access: 'read',
  description:
    'List all transaction groups for the user. Groups bundle related transactions (e.g. split expenses). When includeTransactions is true, each group contains the full transaction list, each with its payee; otherwise returns aggregate counts and date ranges. Pass groupId to read a single group with its transactions.',
  input: {
    groupId: recordId()
      .optional()
      .describe('Group id. When given, returns that one group with its transactions; includeTransactions is ignored.'),
    includeTransactions: z
      .boolean()
      .optional()
      .describe('When true, embed full transaction data in each group. Default: false (aggregates only)'),
  },
  run: async ({ userId, args }) => {
    if (args.groupId) {
      const group = await getTransactionGroupById({ id: args.groupId, userId });
      const transactions = await presentTransactions({
        userId,
        transactions: serializeTransactions(group.transactions ?? []),
      });

      return { id: group.id, name: group.name, note: group.note, transactions };
    }

    const result = await getTransactionGroups({ userId, includeTransactions: args.includeTransactions });

    if (args.includeTransactions) {
      const groups = result as TransactionGroupWithTransactions[];
      // Embedded transactions are full models; run through the REST serializer
      // (Money → decimals) then keep only the AI-relevant fields. One call presents every
      // group's transactions, so the payee names come from a single lookup.
      const presented = await presentTransactions({
        userId,
        transactions: serializeTransactions(groups.flatMap((group) => group.transactions)),
      });
      let offset = 0;
      const slimmed = groups.map((group) => {
        const transactions = presented.slice(offset, offset + group.transactions.length);
        offset += group.transactions.length;
        return { id: group.id, name: group.name, note: group.note, transactions };
      });

      return slimmed;
    }

    const groups = result as TransactionGroupWithAggregates[];
    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      note: group.note,
      transactionCount: group.transactionCount,
      dateFrom: group.dateFrom,
      dateTo: group.dateTo,
    }));
  },
});
