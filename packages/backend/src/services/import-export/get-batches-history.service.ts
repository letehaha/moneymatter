import { type ImportBatchSummary, type ImportBatchesHistoryResponse, type ImportSource } from '@bt/shared/types';
import ImportBatchAccountEffects from '@models/import-batch-account-effects.model';
import ImportBatches from '@models/import-batches.model';
import { findTransactions } from '@models/transactions-query';
import { col, fn, literal } from 'sequelize';

const BATCH_ID_EXPR = `"Transactions"."externalData"->'importDetails'->>'batchId'`;
const SOURCE_EXPR = `"Transactions"."externalData"->'importDetails'->>'source'`;
const IMPORTED_AT_EXPR = `"Transactions"."externalData"->'importDetails'->>'importedAt'`;

interface StampGroup {
  batchId: string;
  source: ImportSource;
  importedAt: string;
  transactionCount: string | number;
  accountIds: string[];
}

/**
 * One entry per import batch, merged from `ImportBatches` rows and the `importDetails`
 * stamps on transactions. A batch row is listed while it has stamped rows or an effect
 * undo can reverse; a stamped batch with no batch row is listed from its stamps alone.
 */
export async function listBatchesHistory({
  userId,
  limit,
  offset,
}: {
  userId: number;
  limit: number;
  offset: number;
}): Promise<ImportBatchesHistoryResponse> {
  // ponytail: loads every batch of the user per request and pages in memory, fine while
  // a user has tens of batches. Move the visibility predicate into SQL and page there.
  const [groups, batches] = await Promise.all([
    findTransactions({
      // Same row set undo deletes, so `transactionCount` matches its `deletedCount`:
      // no planned rows (imports never write them), adjustments and transfer legs kept.
      planned: 'exclude',
      access: { creator: userId },
      balanceAdjustments: 'include',
      where: literal(`${BATCH_ID_EXPR} IS NOT NULL`),
      completeness: 'all',
      attributes: [
        [literal(BATCH_ID_EXPR), 'batchId'],
        // Identical on every row of a batch, so MIN/MAX just pick the shared value.
        [literal(`MIN(${SOURCE_EXPR})`), 'source'],
        // Kept as text: a timestamptz cast makes node-postgres return a JS Date while
        // the field is typed and serialized as a string.
        [fn('MAX', literal(IMPORTED_AT_EXPR)), 'importedAt'],
        [fn('COUNT', col('Transactions.id')), 'transactionCount'],
        [fn('array_agg', fn('DISTINCT', col('accountId'))), 'accountIds'],
      ],
      // Resolves against the `batchId` output column above.
      group: ['batchId'],
      subQuery: false,
      raw: true,
    }) as unknown as Promise<StampGroup[]>,
    ImportBatches.findAll({ where: { userId } }),
  ]);

  const effects =
    batches.length > 0
      ? await ImportBatchAccountEffects.findAll({ where: { importBatchId: batches.map((batch) => batch.id) } })
      : [];

  const undoableEffectsByBatchRowId = new Map<string, ImportBatchAccountEffects[]>();
  for (const effect of effects) {
    if (!effect.createdByImport && effect.absorbedAmount.isZero()) continue;
    const list = undoableEffectsByBatchRowId.get(effect.importBatchId) ?? [];
    list.push(effect);
    undoableEffectsByBatchRowId.set(effect.importBatchId, list);
  }

  const stampOnlyGroups = new Map(groups.map((group) => [group.batchId, group]));
  const items: ImportBatchSummary[] = [];

  for (const batch of batches) {
    const group = stampOnlyGroups.get(batch.batchId);
    stampOnlyGroups.delete(batch.batchId);
    const undoableEffects = undoableEffectsByBatchRowId.get(batch.id) ?? [];
    if (!group && undoableEffects.length === 0) continue;

    items.push({
      batchId: batch.batchId,
      source: batch.source,
      importedAt: batch.importedAt.toISOString(),
      transactionCount: Number(group?.transactionCount ?? 0),
      accountIds: [...new Set([...(group?.accountIds ?? []), ...undoableEffects.map((effect) => effect.accountId)])],
      createdAccountCount: undoableEffects.filter((effect) => effect.createdByImport).length,
    });
  }

  for (const group of stampOnlyGroups.values()) {
    items.push({
      batchId: group.batchId,
      source: group.source,
      importedAt: group.importedAt,
      transactionCount: Number(group.transactionCount),
      accountIds: group.accountIds,
      createdAccountCount: 0,
    });
  }

  // ISO-8601 `Z` strings sort chronologically as text. `batchId` breaks ties between
  // imports stamped in the same millisecond, so paging stays stable.
  items.sort((a, b) => {
    if (a.importedAt !== b.importedAt) return a.importedAt < b.importedAt ? 1 : -1;
    if (a.batchId === b.batchId) return 0;
    return a.batchId < b.batchId ? 1 : -1;
  });

  return {
    items: items.slice(offset, offset + limit),
    totalCount: offset === 0 ? items.length : null,
  };
}
