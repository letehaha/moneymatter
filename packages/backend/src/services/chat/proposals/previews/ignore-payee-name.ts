import PayeeAliases from '@models/payee-aliases.model';
import PayeeIgnoredNames from '@models/payee-ignored-names.model';
import Payees from '@models/payees.model';
import { parsePayeeName, resolveNormalizedName } from '@services/payees/payee-namespace';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import { countPayeeReferences, forUpdate, PreviewError, serializeRow, targetNotFound } from './preview-helpers';
import type { PreviewResolver } from './types';

/**
 * What a card that deletes nothing is checked against: an empty target set, so a payee that matches
 * the name by the time of the approval makes the card stale instead of being deleted unseen.
 */
const NO_TARGETS = { targetHash: hashTargetIds({ ids: [] }), targetCount: 0 };

/**
 * Ignoring a name that still resolves to a payee does nothing unless `force` deletes that payee, so
 * the service refuses without it. The preview does the same, and with `force` shows the payee that
 * goes and the transactions that lose it.
 */
export const resolveIgnorePayeeName: PreviewResolver = async ({ userId, args, lock }) => {
  const { normalized } = parsePayeeName({ raw: args.rawName as string, emptyMessageKey: 'payees.nameRequired' });

  if (await PayeeIgnoredNames.findOne({ where: { userId, normalizedName: normalized } })) {
    return { preview: { before: null }, snapshot: NO_TARGETS, warnings: [{ key: 'chat.warnings.alreadyIgnored' }] };
  }

  const hit = await resolveNormalizedName({ userId, normalized });
  if (!hit) return { preview: { before: null }, snapshot: NO_TARGETS };

  if (args.force !== true) {
    throw new PreviewError({
      messageKey: 'chat.cards.ignoredNameCollides',
      message: `The name still belongs to the payee "${hit.name}", so ignoring it would change nothing. Ask the user whether to delete that payee, and propose again with force.`,
    });
  }

  const payee = await Payees.findOne({ where: { id: hit.payeeId, userId }, ...forUpdate({ lock }) });
  if (!payee) throw targetNotFound({ what: 'payee' });

  const [transactionCount, aliasCount] = await Promise.all([
    countPayeeReferences({ userId, payeeId: payee.id }),
    PayeeAliases.count({ where: { payeeId: payee.id } }),
  ]);

  return {
    preview: { before: serializeRow({ row: payee }), counts: { transactionCount, aliasCount } },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: [payee.updatedAt] }),
      targetHash: hashTargetIds({ ids: [payee.id] }),
      targetCount: 1,
    },
    affectedCount: 1 + transactionCount,
  };
};
