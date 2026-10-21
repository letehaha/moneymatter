import { QueryInterface } from 'sequelize';

/**
 * "UsersCurrencies"."logoUrl": the https URL of the image a user picked for one of their custom
 * currencies. It sits next to "nameOverride", "symbolOverride" and "decimalsOverride" because a
 * custom code's definition is per user. ISO rows keep it `NULL`: the API never writes it for them.
 *
 * `down` drops the column with every logo in it.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(`ALTER TABLE "UsersCurrencies" ADD COLUMN "logoUrl" TEXT DEFAULT NULL;`);
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(`ALTER TABLE "UsersCurrencies" DROP COLUMN "logoUrl";`);
  },
};
