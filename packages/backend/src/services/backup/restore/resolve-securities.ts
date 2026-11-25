import Securities from '@models/investments/securities.model';
import { Op } from 'sequelize';
import { v7 as uuidv7 } from 'uuid';

import type { ArchiveAnalysis } from './analyze-archive';
import { buildInsertRecord, runBulkInsert } from './bulk-insert';
import type { ParsedArchive } from './load-archive';

type Row = Record<string, unknown>;

interface SecuritiesRestoreResult {
  /** Backup securityId → resolved/created securityId, only where they differ. */
  remap: Map<string, string>;
  insertedByTable: Record<string, number>;
  /** Final target id for every backup security (matched, kept, or remapped), deduped. */
  resolvedSecurityIds: string[];
}

function symbolKey({ symbol, currencyCode, providerName }: Row): string {
  return `${String(symbol)}|${String(currencyCode)}|${String(providerName)}`;
}

function providerKey({ providerName, providerSymbol }: Row): string {
  return `${String(providerName)}|${String(providerSymbol)}`;
}

/**
 * Resolve every backup security against the target catalog by natural key
 * (isin → cusip → symbol+currencyCode+providerName → providerName+providerSymbol)
 * and create the ones that don't exist, keeping the backup UUID when free so
 * holdings, investment transactions and watchlist items referencing it need no remap. The
 * providerName+providerSymbol pair is the table's real DB uniqueness (a unique
 * index), so it must be a resolution key — otherwise a backup security matching
 * an existing one only on that pair slips past the natural-key checks and
 * collides on insert. Runs OUTSIDE the main restore transaction: the Securities
 * catalog is global, idempotent identity data, so created rows survive a later
 * rollback of the user's own tables and never need re-creating. Prices are not
 * restored — see SecurityPricing in BACKUP_EXCLUDED.
 */
export async function resolveSecurities({
  archive,
  analysis,
}: {
  archive: ParsedArchive;
  analysis: ArchiveAnalysis;
}): Promise<SecuritiesRestoreResult> {
  const remap = new Map<string, string>();
  const insertedByTable: Record<string, number> = {};
  const resolvedSecurityIds = new Set<string>();
  const backupSecurities = archive.reference.securities;
  if (backupSecurities.length === 0) return { remap, insertedByTable, resolvedSecurityIds: [] };

  const isins = [...new Set(backupSecurities.map((s) => s.isin).filter((v): v is string => typeof v === 'string'))];
  const cusips = [...new Set(backupSecurities.map((s) => s.cusip).filter((v): v is string => typeof v === 'string'))];
  const symbols = [...new Set(backupSecurities.map((s) => s.symbol).filter((v): v is string => typeof v === 'string'))];
  const backupIds = backupSecurities.map((s) => s.id).filter((v): v is string => typeof v === 'string');
  // Only pairs with both parts present — a NULL either side isn't covered by the
  // (providerName, providerSymbol) unique index (Postgres treats NULLs distinct).
  const providerPairs = backupSecurities.filter(
    (s) => typeof s.providerName === 'string' && typeof s.providerSymbol === 'string',
  );
  const providerNames = [...new Set(providerPairs.map((s) => s.providerName as string))];
  const providerSymbols = [...new Set(providerPairs.map((s) => s.providerSymbol as string))];

  const orClauses: Record<string, unknown>[] = [];
  if (isins.length) orClauses.push({ isin: { [Op.in]: isins } });
  if (cusips.length) orClauses.push({ cusip: { [Op.in]: cusips } });
  if (symbols.length) orClauses.push({ symbol: { [Op.in]: symbols } });
  // Over-fetches the cartesian of names×symbols; exact pairs are keyed below.
  if (providerNames.length && providerSymbols.length) {
    orClauses.push({
      [Op.and]: [{ providerName: { [Op.in]: providerNames } }, { providerSymbol: { [Op.in]: providerSymbols } }],
    });
  }

  const [existingByNaturalKey, existingById] = await Promise.all([
    orClauses.length
      ? (Securities.findAll({ where: { [Op.or]: orClauses }, raw: true }) as unknown as Promise<Row[]>)
      : Promise.resolve<Row[]>([]),
    backupIds.length
      ? (Securities.findAll({
          where: { id: { [Op.in]: backupIds } },
          attributes: ['id'],
          raw: true,
        }) as unknown as Promise<Row[]>)
      : Promise.resolve<Row[]>([]),
  ]);

  const byIsin = new Map<string, Row>();
  const byCusip = new Map<string, Row>();
  const bySymbol = new Map<string, Row>();
  const byProviderKey = new Map<string, Row>();
  for (const row of existingByNaturalKey) {
    if (typeof row.isin === 'string') byIsin.set(row.isin, row);
    if (typeof row.cusip === 'string') byCusip.set(row.cusip, row);
    if (typeof row.symbol === 'string') bySymbol.set(symbolKey(row), row);
    if (typeof row.providerName === 'string' && typeof row.providerSymbol === 'string') {
      byProviderKey.set(providerKey(row), row);
    }
  }
  const takenIds = new Set<string>(existingById.map((r) => String(r.id)));

  const securitiesPlan = analysis.plans.get('securities');
  const toInsert: Row[] = [];

  for (const sec of backupSecurities) {
    const match =
      (typeof sec.isin === 'string' && byIsin.get(sec.isin)) ||
      (typeof sec.cusip === 'string' && byCusip.get(sec.cusip)) ||
      (typeof sec.symbol === 'string' && bySymbol.get(symbolKey(sec))) ||
      (typeof sec.providerName === 'string' &&
        typeof sec.providerSymbol === 'string' &&
        byProviderKey.get(providerKey(sec))) ||
      null;

    const backupId = String(sec.id);
    if (match) {
      const resolvedId = String((match as Row).id);
      if (resolvedId !== backupId) remap.set(backupId, resolvedId);
      resolvedSecurityIds.add(resolvedId);
      continue;
    }

    // Keep the backup UUID when nothing already claims it — lets pricing insert
    // without a remap. Fall back to a fresh id (recorded in the remap) only on a
    // genuine id collision with an unrelated existing row.
    let targetId = backupId;
    if (takenIds.has(backupId)) {
      targetId = uuidv7();
      remap.set(backupId, targetId);
    }
    takenIds.add(targetId);
    resolvedSecurityIds.add(targetId);

    if (securitiesPlan) {
      toInsert.push(buildInsertRecord({ row: sec, plan: securitiesPlan, overrides: { id: targetId } }));
    }
  }

  if (toInsert.length) {
    insertedByTable.securities = await runBulkInsert({ model: Securities, records: toInsert });
  }

  return { remap, insertedByTable, resolvedSecurityIds: [...resolvedSecurityIds] };
}
