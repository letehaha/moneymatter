import { DataTypes, QueryInterface } from 'sequelize';

const LOGO_TABLES = ['Budgets', 'Accounts', 'AccountGroups', 'Payees', 'Subscriptions'];

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'Budgets',
        'archivePromptDismissed',
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        { transaction },
      );

      await queryInterface.addColumn(
        'Budgets',
        'logoDomain',
        { type: DataTypes.STRING(253), allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'Budgets',
        'logoInitials',
        { type: DataTypes.STRING(16), allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'Budgets',
        'logoColor',
        { type: DataTypes.STRING(7), allowNull: true },
        { transaction },
      );

      for (const table of LOGO_TABLES) {
        await queryInterface.addColumn(
          table,
          'logoIcon',
          { type: DataTypes.STRING(64), allowNull: true },
          { transaction },
        );
        await queryInterface.addColumn(
          table,
          'logoImageId',
          { type: DataTypes.UUID, allowNull: true },
          { transaction },
        );
      }

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

      await queryInterface.addColumn(
        'Budgets',
        'aiEnabled',
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        { transaction },
      );
      await queryInterface.addColumn(
        'Budgets',
        'aiDescription',
        { type: DataTypes.TEXT, allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'Budgets',
        'aiPreWindowDays',
        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
        { transaction },
      );
      await queryInterface.addColumn(
        'Budgets',
        'aiScannedUntil',
        { type: DataTypes.DATE, allowNull: true, comment: 'Scan cursor: rows updated after it are new to the AI' },
        { transaction },
      );
      await queryInterface.addColumn(
        'Budgets',
        'aiLastScannedAt',
        { type: DataTypes.DATE, allowNull: true },
        { transaction },
      );

      await queryInterface.createTable(
        'TrackerSuggestions',
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
          transactionId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'Transactions', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          score: {
            type: DataTypes.FLOAT,
            allowNull: false,
          },
          reason: {
            type: DataTypes.TEXT,
            allowNull: false,
          },
          status: {
            type: DataTypes.STRING(16),
            allowNull: false,
          },
          createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
          },
          resolvedAt: {
            type: DataTypes.DATE,
            allowNull: true,
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('TrackerSuggestions', ['budgetId', 'transactionId'], {
        unique: true,
        transaction,
      });
      await queryInterface.addIndex('TrackerSuggestions', ['budgetId', 'status'], { transaction });
      await queryInterface.addIndex('TrackerSuggestions', ['transactionId'], { transaction });
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('TrackerSuggestions', { transaction });
      for (const column of ['aiLastScannedAt', 'aiScannedUntil', 'aiPreWindowDays', 'aiDescription', 'aiEnabled']) {
        await queryInterface.removeColumn('Budgets', column, { transaction });
      }
      await queryInterface.dropTable('TrackerLineCategories', { transaction });
      await queryInterface.dropTable('TrackerLines', { transaction });
      for (const table of LOGO_TABLES.toReversed()) {
        await queryInterface.removeColumn(table, 'logoImageId', { transaction });
        await queryInterface.removeColumn(table, 'logoIcon', { transaction });
      }
      await queryInterface.removeColumn('Budgets', 'logoColor', { transaction });
      await queryInterface.removeColumn('Budgets', 'logoInitials', { transaction });
      await queryInterface.removeColumn('Budgets', 'logoDomain', { transaction });
      await queryInterface.removeColumn('Budgets', 'archivePromptDismissed', { transaction });
    });
  },
};
