import { QueryInterface } from 'sequelize';

/**
 * "UsersCurrencies"."rateSourceHttpFingerprint" identifies the HTTP source config whose rates are
 * stored for the currency (a hash of the URL without credential values, the JSON path and the quote
 * currency). A later save of an HTTP source keeps the stored rates when it hands over the same
 * fingerprint, because an HTTP source cannot fetch past days again. `null` until an HTTP source is
 * saved; a source saved before this column is matched through its saved config instead.
 */
module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize
      .query(`ALTER TABLE "UsersCurrencies" ADD COLUMN "rateSourceHttpFingerprint" VARCHAR(64);`)
      .then(() => undefined),
  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize
      .query(`ALTER TABLE "UsersCurrencies" DROP COLUMN "rateSourceHttpFingerprint";`)
      .then(() => undefined),
};
