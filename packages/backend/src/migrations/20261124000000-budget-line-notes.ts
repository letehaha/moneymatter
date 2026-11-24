import { DataTypes, QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'BudgetLineNotes',
        {
          id: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
          },
          periodId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'BudgetPeriods', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          lineId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'BudgetLines', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          note: {
            type: DataTypes.TEXT,
            allowNull: false,
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

      await queryInterface.addIndex('BudgetLineNotes', ['periodId', 'lineId'], {
        unique: true,
        name: 'BudgetLineNotes_periodId_lineId_unique',
        transaction,
      });

      // The unique index above is periodId-leading, so lineId lookups need their own.
      await queryInterface.addIndex('BudgetLineNotes', ['lineId'], { transaction });

      await queryInterface.addColumn(
        'BudgetPeriods',
        'note',
        { type: DataTypes.TEXT, allowNull: true },
        { transaction },
      );
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('BudgetPeriods', 'note', { transaction });
      await queryInterface.dropTable('BudgetLineNotes', { transaction });
    });
  },
};
