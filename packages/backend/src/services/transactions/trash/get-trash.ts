import { TRANSACTION_TRASH_RETENTION_DAYS, isTwoLegTransfer } from '@bt/shared/types';
import type { GetTrashResponse, TransactionModel, TrashEntry } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import TransactionAttachments from '@models/transaction-attachments.model';
import TransactionSplits from '@models/transaction-splits.model';
import TransactionTags from '@models/transaction-tags.model';
import type Transactions from '@models/transactions.model';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { getAccessibleAccountIdsForUser } from '@services/sharing/auth/get-accessible-account-ids.service';
import { addDays } from 'date-fns';
import { type GroupedCountResultItem, Op } from 'sequelize';

import { listAttachedLinks } from './list-attached-links';
import { filterActionableTrashed, findTrashed, findTrashedTwins } from './load-trashed-legs';

const countsByTransaction = ({ rows }: { rows: GroupedCountResultItem[] }) =>
  new Map(rows.map((row) => [String(row.transactionId), Number(row.count)]));

const sumForLegs = ({ counts, legs }: { counts: Map<string, number>; legs: Transactions[] }) =>
  legs.reduce((total, leg) => total + (counts.get(leg.id) ?? 0), 0);

/**
 * The trashed rows the caller can restore or delete, plus their transfer twins on accounts the
 * caller can still reach. Plans stay creator-only. A transfer pair is one entry.
 */
export const getTrash = async ({ userId }: { userId: number }): Promise<GetTrashResponse> => {
  const accessibleIds = await getAccessibleAccountIdsForUser({ userId });
  if (!accessibleIds.length) return [];

  const query = { where: { accountId: { [Op.in]: accessibleIds } }, planned: { visibleTo: userId } };
  const visible = await filterActionableTrashed({ userId, rows: await findTrashed(query) });
  const twins = await findTrashedTwins({ rows: visible, ...query });

  const entries = new Map<string, Transactions[]>();
  for (const row of [...visible, ...twins]) {
    const key = isTwoLegTransfer(row.transferNature) && row.transferId ? `transfer:${row.transferId}` : row.id;
    entries.set(key, [...(entries.get(key) ?? []), row]);
  }
  const batches = [...entries.values()];
  const legIds = batches.flat().map((row) => row.id);
  const perLeg = { transactionId: { [Op.in]: legIds } };

  const [linksByLeg, splits, tags, attachments, accounts] = await Promise.all([
    listAttachedLinks({ userId, transactionIds: legIds }),
    TransactionSplits.count({ where: perLeg, group: ['transactionId'] }).then((rows) => countsByTransaction({ rows })),
    TransactionTags.count({ where: perLeg, group: ['transactionId'] }).then((rows) => countsByTransaction({ rows })),
    TransactionAttachments.count({ where: perLeg, group: ['transactionId'] }).then((rows) =>
      countsByTransaction({ rows }),
    ),
    Accounts.findAll({
      where: { id: { [Op.in]: [...new Set(batches.flat().map((row) => row.accountId))] } },
      attributes: ['id', 'name'],
    }),
  ]);
  const accountNameById = new Map(accounts.map((account) => [account.id, account.name]));
  const visibleIdSet = new Set(visible.map((row) => row.id));

  return batches
    .map((legs): TrashEntry => {
      const deletedAt = new Date(Math.min(...legs.map((leg) => leg.deletedAt!.getTime())));

      return {
        id: legs.find((leg) => visibleIdSet.has(leg.id))!.id,
        deletedAt: deletedAt.toISOString(),
        expiresAt: addDays(deletedAt, TRANSACTION_TRASH_RETENTION_DAYS).toISOString(),
        transactions: serializeTransactions(legs) as unknown as TransactionModel[],
        accountNames: Object.fromEntries(legs.map((leg) => [leg.accountId, accountNameById.get(leg.accountId) ?? ''])),
        kept: {
          splits: sumForLegs({ counts: splits, legs }),
          tags: sumForLegs({ counts: tags, legs }),
          attachments: sumForLegs({ counts: attachments, legs }),
        },
        links: legs.flatMap((leg) => linksByLeg.get(leg.id) ?? []),
      };
    })
    .toSorted((a, b) => a.expiresAt.localeCompare(b.expiresAt));
};
