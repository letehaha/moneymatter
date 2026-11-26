import { DataTypes, QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'DeviceTokens',
        {
          id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
          userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Users', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          token: { type: DataTypes.STRING(200), allowNull: false, unique: true },
          environment: { type: DataTypes.STRING(16), allowNull: false },
          bundleId: { type: DataTypes.STRING(200), allowNull: false },
          createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
          updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        { transaction },
      );
      await queryInterface.addIndex('DeviceTokens', ['userId'], { transaction });

      await queryInterface.addColumn(
        'WatchlistAlerts',
        'notifyPush',
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        { transaction },
      );
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('WatchlistAlerts', 'notifyPush', { transaction });
      await queryInterface.dropTable('DeviceTokens', { transaction });
    });
  },
};
