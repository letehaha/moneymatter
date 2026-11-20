import { DataTypes, QueryInterface, Transaction } from 'sequelize';

const TABLES = ['Accounts', 'Portfolios', 'BankDataProviderConnections'] as const;

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      for (const table of TABLES) {
        await queryInterface.addColumn(
          table,
          'externalUrl',
          { type: DataTypes.STRING(2048), allowNull: true },
          { transaction: t },
        );
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      for (const table of TABLES) {
        await queryInterface.removeColumn(table, 'externalUrl', { transaction: t });
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
