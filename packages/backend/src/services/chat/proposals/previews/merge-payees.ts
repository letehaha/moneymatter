import type { ChatCardAffected } from '@bt/shared/types';
import PayeeAliases from '@models/payee-aliases.model';
import Payees from '@models/payees.model';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import {
  assertConcreteTargets,
  countPayeeTransactions,
  forUpdate,
  PreviewError,
  targetNotFound,
} from './preview-helpers';
import type { PreviewResolver } from './types';

/**
 * A merge moves the source's transactions and aliases to the target and deletes the source. The
 * card lists the source with those counts; the typed phrase is what moves.
 */
export const resolveMergePayees: PreviewResolver = async ({ userId, args, lock }) => {
  const sourceId = args.sourceId as string;
  const targetId = args.targetId as string;
  assertConcreteTargets({ value: [sourceId, targetId], what: 'payee' });

  if (sourceId === targetId) {
    throw new PreviewError({ messageKey: 'chat.cards.mergeSelf', message: 'A payee cannot be merged into itself' });
  }

  const source = await Payees.findOne({ where: { id: sourceId, userId }, ...forUpdate({ lock }) });
  const target = source ? await Payees.findOne({ where: { id: targetId, userId }, ...forUpdate({ lock }) }) : null;
  if (!source || !target) throw targetNotFound({ what: 'payee' });

  const [transactionCount, aliasCount] = await Promise.all([
    countPayeeTransactions({ userId, payeeId: sourceId }),
    PayeeAliases.count({ where: { payeeId: sourceId } }),
  ]);
  const moving = transactionCount + aliasCount;

  const affected: ChatCardAffected = {
    count: moving,
    columns: [
      { key: 'payee', label: 'chat.cards.columns.payee', kind: 'entity' },
      { key: 'transactions', label: 'chat.cards.columns.transactions', kind: 'number' },
      { key: 'aliases', label: 'chat.cards.columns.aliases', kind: 'number' },
    ],
    rows: [{ payee: { kind: 'payee', id: sourceId }, transactions: transactionCount, aliases: aliasCount }],
    truncated: false,
  };

  return {
    preview: { affected, counts: { transactionCount, aliasCount } },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: [source.updatedAt, target.updatedAt] }),
      targetHash: hashTargetIds({ ids: [sourceId, targetId] }),
      targetCount: 2,
    },
    affectedCount: moving,
  };
};
