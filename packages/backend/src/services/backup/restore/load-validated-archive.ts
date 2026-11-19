import { ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';

import { type ArchiveAnalysis, analyzeArchive } from './analyze-archive';
import { type ParsedArchive, loadBackupArchive } from './load-archive';
import { roundMoneyToCurrencyDecimals } from './round-to-currency-decimals';

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
  const currencies = await Currencies.findAll({ attributes: ['code', 'digits'] });
  const digitsByCode = new Map(currencies.map(({ code, digits }) => [code, digits]));
  roundMoneyToCurrencyDecimals({ data: archive.data, digitsByCode });
  return { archive, analysis, currencyCodes: new Set(digitsByCode.keys()) };
}
