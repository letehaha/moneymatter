import type { ChatCardWarning } from '@bt/shared/types';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import { ENTITY_LOADERS } from './entity-loaders';
import {
  assertConcreteTargets,
  keepVisibleRows,
  PreviewError,
  targetNotFound,
  transactionsAffected,
} from './preview-helpers';
import type { PreviewResolver } from './types';

/**
 * The generic resolver of an update or delete card: the row the call targets as it is now, with its
 * related counts. The card shows the value before beside each argument the call changes. A delete
 * that takes other rows with it (an account's transactions) counts them, so the typed phrase covers
 * everything that goes; a high-impact card always types the count.
 */
export const resolveEntityPreview: PreviewResolver = async ({ userId, args, policy, lock }) => {
  const loader = ENTITY_LOADERS[policy.entity];
  if (!loader) throw new Error(`No entity loader for ${policy.entity}`);

  const targets = policy.targetFields.map((field) => {
    const value = args[field];
    if (typeof value !== 'string') {
      throw new PreviewError({
        messageKey: 'chat.cards.targetMissing',
        message: `${policy.name} does not name its target (${field})`,
      });
    }
    assertConcreteTargets({ value, what: policy.entity });
    return value;
  });

  const entity = await loader({ userId, targets, args, lock });
  if (!entity) throw targetNotFound({ what: policy.entity });

  const existing = entity.row !== null;
  // The target leg of a transfer comes first. A delete takes the other legs with it; an update
  // changes them. Either way the card counts them, lists those on accounts the user can see, and
  // snapshots them, so an edit of the other leg alone makes the card stale.
  const legs = entity.legs ?? [];
  const twins = legs.slice(1);
  const deletesTwins = policy.kind === 'delete' && twins.length > 0;
  const removes = entity.removes + (deletesTwins ? twins.length : 0);
  const warnings: ChatCardWarning[] = [
    ...(deletesTwins ? [{ key: 'chat.warnings.transferTwinsOfRow', params: { count: twins.length } }] : []),
    // A payee delete that also ignores the names adds them to the ignore list, which nothing here undoes.
    ...(policy.name === 'delete_payee' && args.ignoreFuture === true ? [{ key: 'chat.warnings.payeesIgnored' }] : []),
  ];

  return {
    preview: {
      before: entity.row,
      ...(Object.keys(entity.counts).length > 0 ? { counts: entity.counts } : {}),
      ...(twins.length > 0
        ? {
            affected: transactionsAffected({ rows: await keepVisibleRows({ userId, rows: legs }), count: legs.length }),
          }
        : {}),
    },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: [entity.updatedAt, ...twins.map((twin) => twin.updatedAt)] }),
      targetHash: hashTargetIds({ ids: existing ? [targets.join(':'), ...twins.map((twin) => twin.id)] : [] }),
      targetCount: existing ? 1 + twins.length : 0,
    },
    ...(policy.danger === 'highImpact' || removes > 0 ? { affectedCount: 1 + removes } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};
