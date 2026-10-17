import type { BackupRestoreWarning } from '@bt/shared/types';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
import { isCurrencyCodeFormat } from '@common/lib/currency-code-format';
import Currencies from '@models/currencies.model';
import { insertOrAdopt } from '@services/common/run-in-savepoint';
import cc from 'currency-codes';
import { Op, type Transaction } from 'sequelize';

import type { ParsedArchive } from './load-archive';

type Row = Record<string, unknown>;

const NAME_MAX_LENGTH = 255;
const SYMBOL_MAX_LENGTH = 8;
const DECIMALS_MAX = 18;

export interface CustomCurrencyDefinition {
  code: string;
  name: string;
  decimals: number;
  symbol: string | null;
}

/** A backup row that is a well-formed custom currency definition, or `null`. */
const parseDefinition = ({ row }: { row: Row }): CustomCurrencyDefinition | null => {
  const { code, currency: name, digits, symbol } = row;

  if (typeof code !== 'string' || !isCurrencyCodeFormat(code) || code.length > CURRENCY_CODE_MAX_LENGTH) return null;
  // An ISO code is never user-defined, whatever the archive says.
  if (cc.code(code) !== undefined) return null;
  if (typeof name !== 'string' || !name.trim() || name.length > NAME_MAX_LENGTH) return null;
  if (typeof digits !== 'number' || !Number.isInteger(digits) || digits < 0 || digits > DECIMALS_MAX) return null;
  if (symbol != null && (typeof symbol !== 'string' || !symbol.length || symbol.length > SYMBOL_MAX_LENGTH))
    return null;

  return { code, name, decimals: digits, symbol: (symbol as string | null | undefined) ?? null };
};

/**
 * Makes the global `Currencies` rows of the backup's custom currencies exist on this instance:
 * a row that already carries the code is reused as it is (the archive never rewrites a definition
 * another user may hold), and a missing one is created for the restoring user. Runs inside the
 * restore transaction, so a failed restore leaves no row behind.
 *
 * Returns the custom codes that exist after the call. Only those may be attached by the restored
 * `users-currencies` rows: a code the archive does not define stays unattachable, which keeps a
 * crafted archive from linking someone else's custom currency to its uploader.
 */
export const restoreCustomCurrencies = async ({
  archive,
  targetUserId,
  transaction,
  warnings,
}: {
  archive: ParsedArchive;
  targetUserId: number;
  transaction: Transaction;
  warnings: BackupRestoreWarning[];
}): Promise<{ codes: Set<string>; definitions: Map<string, CustomCurrencyDefinition> }> => {
  const definitions = new Map<string, CustomCurrencyDefinition>();
  let invalidCount = 0;

  for (const row of archive.reference.customCurrencies) {
    const definition = parseDefinition({ row });
    if (definition) definitions.set(definition.code, definition);
    else invalidCount += 1;
  }

  if (invalidCount > 0) {
    warnings.push({
      code: 'invalid_row_dropped',
      table: 'custom-currencies',
      count: invalidCount,
    });
  }

  const codes = new Set<string>();
  if (definitions.size === 0) return { codes, definitions };

  const existing = await Currencies.findAll({
    where: { code: { [Op.in]: [...definitions.keys()] } },
    attributes: ['code', 'isCustom'],
    transaction,
  });
  const existingByCode = new Map(existing.map((row) => [row.code, row]));

  for (const definition of definitions.values()) {
    const row = existingByCode.get(definition.code);

    if (row?.isCustom) {
      codes.add(definition.code);
      continue;
    }
    // The code is an ISO currency on this instance, which no user definition may replace.
    if (row) continue;

    // Another restore or user may define the same new code at the same moment; the loser adopts the winner's row.
    const created = await insertOrAdopt({
      insert: () =>
        Currencies.create(
          {
            code: definition.code,
            currency: definition.name,
            digits: definition.decimals,
            number: null,
            isCustom: true,
            symbol: definition.symbol,
            createdByUserId: targetUserId,
          },
          { transaction },
        ),
      adopt: () => Currencies.findOne({ where: { code: definition.code }, transaction }),
    });
    if (created.isCustom) codes.add(definition.code);
  }

  return { codes, definitions };
};
