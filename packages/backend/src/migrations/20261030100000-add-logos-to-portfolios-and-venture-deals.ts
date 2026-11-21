import { DataTypes, QueryInterface, Transaction } from 'sequelize';

const TABLES = ['Portfolios', 'VentureDeals'] as const;

const LOGO_COLUMNS = {
  logoDomain: DataTypes.STRING(253),
  logoInitials: DataTypes.STRING(16),
  logoColor: DataTypes.STRING(7),
  logoIcon: DataTypes.STRING(64),
  logoImageId: DataTypes.UUID,
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      for (const table of TABLES) {
        for (const [column, type] of Object.entries(LOGO_COLUMNS)) {
          await queryInterface.addColumn(table, column, { type, allowNull: true }, { transaction: t });
        }
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
        for (const column of Object.keys(LOGO_COLUMNS)) {
          await queryInterface.removeColumn(table, column, { transaction: t });
        }
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
