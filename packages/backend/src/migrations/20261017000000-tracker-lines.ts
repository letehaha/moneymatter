import { DataTypes, QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'Budgets',
        'archivePromptDismissed',
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        { transaction },
      );

      await queryInterface.createTable(
        'TrackerLines',
        {
          id: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
          },
          budgetId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'Budgets', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          name: {
            type: DataTypes.STRING(200),
            allowNull: false,
          },
          limitAmount: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Cents; NULL = no limit on this line',
          },
          position: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
          createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
          },
          updatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('TrackerLines', ['budgetId'], { transaction });

      await queryInterface.createTable(
        'TrackerLineCategories',
        {
          lineId: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
            references: { model: 'TrackerLines', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          categoryId: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
            references: { model: 'Categories', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('TrackerLineCategories', ['categoryId'], { transaction });
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('TrackerLineCategories', { transaction });
      await queryInterface.dropTable('TrackerLines', { transaction });
      await queryInterface.removeColumn('Budgets', 'archivePromptDismissed', { transaction });
    });
  },
};
