import { ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';

import { type ArchiveAnalysis, analyzeArchive } from './analyze-archive';
import { type ParsedArchive, loadBackupArchive } from './load-archive';
import { type CustomCurrencyDefinition, readCustomCurrencyDefinitions } from './resolve-custom-currencies';
import { roundMoneyToCurrencyDecimals } from './round-to-currency-decimals';

/**
 * Load + analyze a backup archive and round its amounts to their currencies' decimals, throwing a
 * 422 `ValidationError` on any hard failure. Shared by the sync preflight and the worker (which
 * re-parses because the archive can't ride through Redis) so the two can't drift on the
 * validation contract.
 */
export async function loadValidatedArchive({ fileContent }: { fileContent: string }): Promise<{
  archive: ParsedArchive;
  analysis: ArchiveAnalysis;
  /** Codes a restored row may name: the ISO seed plus the archive's own custom codes. */
  currencyCodes: Set<string>;
  customDefinitions: Map<string, CustomCurrencyDefinition>;
}> {
  const archive = await loadBackupArchive({ fileContent });
  const analysis = analyzeArchive({ archive });
  if (analysis.hardFailReasons.length > 0) {
    throw new ValidationError({ message: analysis.hardFailReasons.join(' ') });
  }
  const currencies = await Currencies.findAll({ where: { isCustom: false }, attributes: ['code', 'digits'] });
  const digitsByCode = new Map(currencies.map(({ code, digits }) => [code, digits]));
  const customDefinitions = readCustomCurrencyDefinitions({ archive, isoCodes: new Set(digitsByCode.keys()) });
  // A custom code rounds at the archive's own definition, never at another user's row for the same code.
  for (const { code, decimals } of customDefinitions.values()) digitsByCode.set(code, decimals);

  roundMoneyToCurrencyDecimals({ data: archive.data, digitsByCode });
  return { archive, analysis, currencyCodes: new Set(digitsByCode.keys()), customDefinitions };
}
