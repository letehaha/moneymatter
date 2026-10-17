import { CURRENCY_CODE_COLUMNS } from '@common/lib/currency-code-columns';
import { invalidateCurrencyDecimalsCache } from '@common/lib/currency-decimals-cache';
import { connection } from '@models/index';
import { QueryTypes } from 'sequelize';

/**
 * Columns that can still point at a custom code once no user holds it. `Currencies` and
 * `UsersCurrencies` are the definition and the holdings themselves, and `ExchangeRates` never
 * carries a custom code (global rate sync skips them), so scanning it would only cost time.
 */
const REFERENCING_COLUMNS = CURRENCY_CODE_COLUMNS.filter(
  ({ table }) => table !== 'Currencies' && table !== 'UsersCurrencies' && table !== 'ExchangeRates',
);

/**
 * Cleans the global rows of user-defined currencies after a holding goes away.
 *
 * - A custom `Currencies` row that no `UsersCurrencies` row holds any more is deleted, unless a
 *   currency-code column still references it (the foreign key would refuse, and a failed statement
 *   aborts the surrounding transaction).
 * - A row that survives because another user holds it loses `createdByUserId` when its creator no
 *   longer holds it, so the column never names a deleted or departed user.
 *
 * Runs on the ambient transaction. Call it after the holdings are removed: from the user
 * destroy lifecycle (delete and wipe) and from `DELETE /user/currencies/custom/:code`.
 */
export const pruneUnusedCustomCurrencies = async (): Promise<{ deletedCodes: string[] }> => {
  const candidates = (await connection.sequelize.query(
    `SELECT c."code" FROM "Currencies" c
     WHERE c."isCustom" = true
       AND NOT EXISTS (SELECT 1 FROM "UsersCurrencies" u WHERE u."currencyCode" = c."code")`,
    { type: QueryTypes.SELECT },
  )) as { code: string }[];

  const deletedCodes: string[] = [];

  if (candidates.length) {
    const codes = candidates.map(({ code }) => code);
    const stillReferenced = new Set<string>();

    for (const { table, column } of REFERENCING_COLUMNS) {
      const rows = (await connection.sequelize.query(
        `SELECT DISTINCT "${column}" AS "code" FROM "${table}" WHERE "${column}" IN (:codes)`,
        { replacements: { codes }, type: QueryTypes.SELECT },
      )) as { code: string }[];
      rows.forEach(({ code }) => stillReferenced.add(code));
    }

    const deletable = codes.filter((code) => !stillReferenced.has(code));

    if (deletable.length) {
      await connection.sequelize.query(`DELETE FROM "Currencies" WHERE "isCustom" = true AND "code" IN (:deletable)`, {
        replacements: { deletable },
      });
      deletedCodes.push(...deletable);
      // A raw DELETE fires no model hook, so the cached decimals of the removed codes are dropped here.
      deletable.forEach((code) => invalidateCurrencyDecimalsCache({ code }));
    }
  }

  await connection.sequelize.query(
    `UPDATE "Currencies" c SET "createdByUserId" = NULL
     WHERE c."isCustom" = true
       AND c."createdByUserId" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "UsersCurrencies" u
         WHERE u."currencyCode" = c."code" AND u."userId" = c."createdByUserId"
       )`,
  );

  return { deletedCodes };
};
