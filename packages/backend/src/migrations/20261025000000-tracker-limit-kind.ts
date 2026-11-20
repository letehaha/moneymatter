import { DataTypes, QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.addColumn('Trackers', 'limitKind', {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'spending',
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn('Trackers', 'limitKind');
  },
};
