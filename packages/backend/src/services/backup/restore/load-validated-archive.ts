import { CUSTOM_CURRENCY_DECIMALS_MAX, CUSTOM_CURRENCY_DECIMALS_MIN } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';

import { type ArchiveAnalysis, analyzeArchive } from './analyze-archive';
import { type ParsedArchive, loadBackupArchive } from './load-archive';
import { parseCustomCurrencyDefinition } from './resolve-custom-currencies';
import { roundMoneyToCurrencyDecimals } from './round-to-currency-decimals';

const findArchiveDecimalsOverride = ({ archive, code }: { archive: ParsedArchive; code: string }): number | null => {
  const value = (archive.data.get('users-currencies') ?? []).find((row) => row.currencyCode === code)?.decimalsOverride;

  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= CUSTOM_CURRENCY_DECIMALS_MIN &&
    value <= CUSTOM_CURRENCY_DECIMALS_MAX
    ? value
    : null;
};

/**
 * Load + analyze a backup archive and round its amounts to their currencies' decimals, throwing a
 * 422 `ValidationError` on any hard failure. Shared by the sync preflight and the worker (which
 * re-parses because the archive can't ride through Redis) so the two can't drift on the
 * validation contract.
 */
export async function loadValidatedArchive({
  fileContent,
}: {
  fileContent: string;
}): Promise<{ archive: ParsedArchive; analysis: ArchiveAnalysis; currencyCodes: Set<string> }> {
  const archive = await loadBackupArchive({ fileContent });
  const analysis = analyzeArchive({ archive });
  if (analysis.hardFailReasons.length > 0) {
    throw new ValidationError({ message: analysis.hardFailReasons.join(' ') });
  }
  const currencies = await Currencies.findAll({ where: { isCustom: false }, attributes: ['code', 'digits'] });
  const digitsByCode = new Map(currencies.map(({ code, digits }) => [code, digits]));
  // A custom code rounds at the archive's own definition, never at another user's row for the same code.
  for (const row of archive.reference.customCurrencies) {
    const definition = parseCustomCurrencyDefinition({ row });
    if (definition && !digitsByCode.has(definition.code)) {
      digitsByCode.set(
        definition.code,
        findArchiveDecimalsOverride({ archive, code: definition.code }) ?? definition.decimals,
      );
    }
  }
  roundMoneyToCurrencyDecimals({ data: archive.data, digitsByCode });
  return { archive, analysis, currencyCodes: new Set(digitsByCode.keys()) };
}
