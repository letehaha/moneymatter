import Currencies from '@models/currencies.model';
import { Op } from 'sequelize';

/**
 * Whether a stored code is custom. An existing row never switches kind: ISO rows are seeded and
 * the custom-code format refuses ISO codes, so a verdict is final and is remembered for the life of
 * the process. A code with no row is not remembered, because a custom row can appear later.
 */
const knownKinds = new Map<string, boolean>();

/** The subset of `codes` that names custom currencies. Unknown codes count as not custom. */
export const findCustomCurrencyCodes = async ({ codes }: { codes: readonly string[] }): Promise<Set<string>> => {
  const unique = [...new Set(codes.map((code) => code.toUpperCase()))];
  const unknown = unique.filter((code) => !knownKinds.has(code));

  if (unknown.length) {
    const rows = await Currencies.findAll({
      where: { code: { [Op.in]: unknown } },
      attributes: ['code', 'isCustom'],
      raw: true,
    });
    rows.forEach((row) => knownKinds.set(row.code, row.isCustom));
  }

  return new Set(unique.filter((code) => knownKinds.get(code) === true));
};

/** Whether any of `codes` is a custom currency. */
export const includesCustomCurrencyCode = async ({ codes }: { codes: readonly string[] }): Promise<boolean> =>
  (await findCustomCurrencyCodes({ codes })).size > 0;
