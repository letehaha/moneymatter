import Payees from '@models/payees.model';
import { Transaction } from 'sequelize';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import { assertConcreteTargets, countPayeeTransactions, serializeRow, targetNotFound } from './preview-helpers';
import type { PreviewResolver } from './types';

/**
 * Applying a payee's default tags adds them to every transaction already linked to it. The card
 * shows the payee, how many default tags it has and how many transactions it touches.
 */
export const resolveApplyPayeeTags: PreviewResolver = async ({ userId, args, lock }) => {
  const payeeId = args.payeeId as string;
  assertConcreteTargets({ value: payeeId, what: 'payee' });

  const payee = await Payees.findOne({
    where: { id: payeeId, userId },
    include: [{ association: 'defaultTags', attributes: ['id'] }],
    // The join is an outer one, which `FOR UPDATE` refuses unless it names the table it holds.
    ...(lock ? { lock: { level: Transaction.LOCK.UPDATE, of: Payees } } : {}),
  });
  if (!payee) throw targetNotFound({ what: 'payee' });

  const tagCount = payee.defaultTags?.length ?? 0;

  return {
    preview: {
      before: serializeRow({ row: payee }),
      counts: { transactionCount: await countPayeeTransactions({ userId, payeeId }), tagCount },
    },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: [payee.updatedAt] }),
      targetHash: hashTargetIds({ ids: [payeeId] }),
      targetCount: 1,
    },
    ...(tagCount === 0 ? { warnings: [{ key: 'chat.warnings.noDefaultTags' }] } : {}),
  };
};
