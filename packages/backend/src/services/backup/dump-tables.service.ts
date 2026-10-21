import type { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import Currencies from '@models/currencies.model';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Securities from '@models/investments/securities.model';
import MerchantCategoryCodes from '@models/merchant-category-codes.model';
import UsersCurrencies from '@models/users-currencies.model';
import { applyCurrencyOverrides } from '@services/currencies/effective-currency';
import isPlainObject from 'lodash/isPlainObject';
import omit from 'lodash/omit';
import { Op } from 'sequelize';

import { BACKUP_TABLES, type BackupDumpScope, type BackupTableDef } from './registry';
import { createScopeResolver, type ScopeResolver } from './scope-resolver';

type Row = Record<string, unknown>;

/** One serialized file destined for the zip. */
export interface BackupFile {
  /** Path inside the zip, e.g. `data/categories.json`. */
  path: string;
  /** Row count (1 for the single-object `data/user.json`). */
  rows: number;
  buffer: Buffer;
}

export function toBuffer({ value }: { value: unknown }): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

async function whereForScope({
  scope,
  userId,
  resolver,
}: {
  scope: BackupDumpScope;
  userId: number;
  resolver: ScopeResolver;
}): Promise<Record<string, unknown>> {
  switch (scope.strategy) {
    case 'root':
      return { id: userId };
    case 'userColumn':
      return { [scope.column]: userId };
    case 'viaParent': {
      // Empty id set → `IN (NULL)`, which matches no rows (correct: the user
      // owns no parents, so the child table is empty).
      const parentIds = await resolver.getScope({ scope: scope.parent });
      return { [scope.fk]: { [Op.in]: parentIds } };
    }
  }
}

const isRow = (value: unknown): value is Row => isPlainObject(value);

/**
 * Key ciphertext never travels in an archive: a connection that had a key comes back
 * flagged invalid, asking (in the settings' own locale) for the key again. Legacy
 * `apiKeys`/`customEndpoints` are dropped, not converted: converting would rebuild
 * `connections` from the legacy data alone. Never throws.
 */
export function stripConnectionKeys({ settings }: { settings: unknown }): unknown {
  if (!isRow(settings) || !isRow(settings.ai)) return settings;

  const ai = omit(settings.ai, ['apiKeys', 'customEndpoints']);
  if (ai.connections == null) return { ...settings, ai };
  if (!Array.isArray(ai.connections)) {
    // Fail closed: a shape this can't walk entry by entry might carry ciphertext.
    logger.warn('stripConnectionKeys: settings.ai.connections is not an array; dropping the ai block');
    return omit(settings, 'ai');
  }

  const invalidatedAt = new Date().toISOString();
  const lastError = t({
    key: 'ai.connectionKeyNotInBackup',
    locale: typeof settings.locale === 'string' ? settings.locale : undefined,
  });
  const connections = ai.connections.map((connection: unknown) =>
    isRow(connection) && 'keyEncrypted' in connection
      ? { ...omit(connection, 'keyEncrypted'), status: 'invalid', invalidatedAt, lastError }
      : connection,
  );

  return { ...settings, ai: { ...ai, connections } };
}

function stripAiKeys({ rows }: { rows: Row[] }): void {
  for (const row of rows) row.settings = stripConnectionKeys({ settings: row.settings });
}

/** Attach each row's MCC natural `code` (stored as a string) for restore remap. */
async function attachMccCodes({ rows }: { rows: Row[] }): Promise<void> {
  const mccIds = [...new Set(rows.map((r) => r.mccId).filter((id): id is number => id != null))];
  if (mccIds.length === 0) return;
  const codes = (await MerchantCategoryCodes.findAll({
    where: { id: { [Op.in]: mccIds } },
    attributes: ['id', 'code'],
    raw: true,
  })) as unknown as { id: number; code: string | number }[];
  const codeById = new Map(codes.map((c) => [c.id, String(c.code)]));
  for (const row of rows) {
    row.mccCode = row.mccId != null ? (codeById.get(row.mccId as number) ?? null) : null;
  }
}

async function dumpTable({
  def,
  userId,
  resolver,
}: {
  def: BackupTableDef;
  userId: number;
  resolver: ScopeResolver;
}): Promise<BackupFile> {
  const where = await whereForScope({ scope: def.scope, userId, resolver });

  if (def.single) {
    // Without an explicit field list Sequelize would dump every column (the
    // auth-adjacent ones for Users), so refuse rather than over-export.
    if (!def.fields) {
      throw new Error(`Backup registry misconfig: single table "${def.fileName}" has no fields to dump.`);
    }
    // Users: emit the restorable subset as a single object, not an array.
    const row = (await def.model.findOne({
      where,
      attributes: def.fields as string[],
      raw: true,
    })) as unknown as Row | null;
    return { path: `data/${def.fileName}.json`, rows: row ? 1 : 0, buffer: toBuffer({ value: row ?? {} }) };
  }

  // raw:true is the sanctioned exception to the "no raw on Money" rule: a
  // backup must carry exact DB storage values (decimal strings for money,
  // JSONB, arrays) and bypassing the @MoneyField getters is the point.
  const rows = (await def.model.findAll({ where, raw: true, paranoid: false })) as unknown as Row[];

  if (def.stripSecret === 'aiKeys') stripAiKeys({ rows });
  if (def.stripSecret === 'bankCredentials') {
    for (const row of rows) row.credentials = null;
  }
  if (def.enrichMccCode) await attachMccCodes({ rows });

  return { path: `data/${def.fileName}.json`, rows: rows.length, buffer: toBuffer({ value: rows }) };
}

/**
 * Securities referenced by the user's holdings and investment transactions (the
 * only two owner-scoped tables carrying a `securityId`). Identity only — restore
 * resolves-or-creates by natural key. Prices are not dumped: derived market data
 * the instance refetches, never trusted from an uploaded backup.
 */
async function dumpReferenceFiles({
  resolver,
  userId,
}: {
  resolver: ScopeResolver;
  userId: number;
}): Promise<BackupFile[]> {
  const portfolioIds = await resolver.getScope({ scope: 'portfolios' });

  let securityIds: RecordId[] = [];
  if (portfolioIds.length > 0) {
    const [holdings, invTx] = await Promise.all([
      Holdings.findAll({
        where: { portfolioId: { [Op.in]: portfolioIds } },
        attributes: ['securityId'],
        raw: true,
        paranoid: false,
      }),
      InvestmentTransaction.findAll({
        where: { portfolioId: { [Op.in]: portfolioIds } },
        attributes: ['securityId'],
        raw: true,
        paranoid: false,
      }),
    ]);
    const ids = [...holdings, ...invTx]
      .map((r) => (r as unknown as { securityId: RecordId | null }).securityId)
      .filter((id): id is RecordId => id != null);
    securityIds = [...new Set(ids)];
  }

  const securities = securityIds.length
    ? await Securities.findAll({ where: { id: { [Op.in]: securityIds } }, raw: true })
    : [];

  const customCurrencies = await dumpCustomCurrencies({ userId });

  return [
    { path: 'reference/securities.json', rows: securities.length, buffer: toBuffer({ value: securities }) },
    {
      path: 'reference/custom-currencies.json',
      rows: customCurrencies.length,
      buffer: toBuffer({ value: customCurrencies }),
    },
  ];
}

/**
 * The definitions (code, name, decimals, symbol) of the custom currencies the user holds, as THIS
 * user defined them: their own overrides on top of the global row. The global row carries whoever
 * created the code first, so exporting it would hand one user another user's name, symbol and
 * decimals. A restore on a fresh instance creates the global row from this definition, and on an
 * instance that already has the code the user's own overrides travel in `users-currencies`.
 * Nothing that names a creator travels.
 */
async function dumpCustomCurrencies({ userId }: { userId: number }): Promise<Row[]> {
  const held = (await UsersCurrencies.findAll({
    where: { userId },
    include: [{ model: Currencies, as: 'currency', where: { isCustom: true }, required: true }],
    order: [['currencyCode', 'ASC']],
  })) as (UsersCurrencies & { currency: Currencies })[];

  return held.map((row) => {
    const { code, name, decimals, symbol } = applyCurrencyOverrides({ currency: row.currency, overrides: row });

    return { code, currency: name, digits: decimals, symbol, isCustom: true };
  });
}

/** Dump every backup file (data + reference) for one user. */
export async function dumpBackupFiles({ userId }: { userId: number }): Promise<BackupFile[]> {
  const resolver = createScopeResolver({ userId });

  // Sequential dumps keep peak memory bounded (one materialized table at a
  // time) and let the scope resolver's cache warm before dependents run.
  const dataFiles: BackupFile[] = [];
  for (const def of BACKUP_TABLES) {
    dataFiles.push(await dumpTable({ def, userId, resolver }));
  }

  const referenceFiles = await dumpReferenceFiles({ resolver, userId });
  return [...dataFiles, ...referenceFiles];
}
