import { DataTypes, QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.addColumn('Holdings', 'lossAlertedAt', { type: DataTypes.DATE, allowNull: true });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn('Holdings', 'lossAlertedAt');
  },
};
