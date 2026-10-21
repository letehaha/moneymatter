import PayeeAliases from '@models/payee-aliases.model';
import Payees from '@models/payees.model';
import { findTransactions } from '@models/transactions-query';
import { col, fn } from 'sequelize';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import { assertConcreteTargets, forUpdate, SAMPLE_ROW_LIMIT, targetNotFound } from './preview-helpers';
import type { PreviewResolver } from './types';

type CountRow = { payeeId: string; count: string | number };

const sum = (counts: Map<string, number>) => [...counts.values()].reduce((total, value) => total + value, 0);

const countsByPayee = ({ rows }: { rows: CountRow[] }) => new Map(rows.map((row) => [row.payeeId, Number(row.count)]));

/**
 * Deleting payees keeps their transactions (which lose the payee, whoever wrote them) and removes their aliases. All or
 * nothing: one id that is not the user's refuses the whole call, as the service does.
 */
export const resolveBulkDeletePayees: PreviewResolver = async ({ userId, args, lock }) => {
  const ids = [...new Set(args.ids as string[])];
  assertConcreteTargets({ value: ids, what: 'payee' });

  const payees = await Payees.findAll({ where: { userId, id: ids }, ...forUpdate({ lock }) });
  if (payees.length !== ids.length) throw targetNotFound({ what: 'payee' });

  const [transactionRows, aliasRows] = await Promise.all([
    findTransactions({
      planned: 'include',
      access: { accessibleTo: userId },
      balanceAdjustments: 'include',
      completeness: 'all',
      where: { payeeId: ids },
      attributes: ['payeeId', [fn('COUNT', col('id')), 'count']],
      group: ['payeeId'],
      raw: true,
    }) as unknown as Promise<CountRow[]>,
    PayeeAliases.findAll({
      where: { payeeId: ids },
      attributes: ['payeeId', [fn('COUNT', col('id')), 'count']],
      group: ['payeeId'],
      raw: true,
    }) as unknown as Promise<CountRow[]>,
  ]);
  const transactions = countsByPayee({ rows: transactionRows });
  const aliases = countsByPayee({ rows: aliasRows });

  return {
    preview: {
      affected: {
        count: payees.length,
        columns: [
          { key: 'payee', label: 'chat.cards.columns.payee', kind: 'entity' },
          { key: 'transactions', label: 'chat.cards.columns.transactions', kind: 'number' },
          { key: 'aliases', label: 'chat.cards.columns.aliases', kind: 'number' },
        ],
        rows: payees.slice(0, SAMPLE_ROW_LIMIT).map((payee) => ({
          payee: { kind: 'payee' as const, id: payee.id },
          transactions: transactions.get(payee.id) ?? 0,
          aliases: aliases.get(payee.id) ?? 0,
        })),
        truncated: payees.length > SAMPLE_ROW_LIMIT,
      },
      counts: { transactionCount: sum(transactions), aliasCount: sum(aliases) },
    },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: payees.map((payee) => payee.updatedAt) }),
      targetHash: hashTargetIds({ ids }),
      targetCount: payees.length,
    },
    affectedCount: payees.length,
    ...(args.ignoreFuture === true ? { warnings: [{ key: 'chat.warnings.payeesIgnored' }] } : {}),
  };
};
