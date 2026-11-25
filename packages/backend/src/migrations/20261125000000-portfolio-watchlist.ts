import { DataTypes, QueryInterface } from 'sequelize';

const timestamps = {
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
};

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'WatchlistSections',
        {
          id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
          portfolioId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'Portfolios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          name: { type: DataTypes.STRING(100), allowNull: false },
          sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          ...timestamps,
        },
        { transaction },
      );
      await queryInterface.addIndex('WatchlistSections', ['portfolioId'], { transaction });

      await queryInterface.createTable(
        'WatchlistItems',
        {
          id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
          portfolioId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'Portfolios', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          securityId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'Securities', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          sectionId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: { model: 'WatchlistSections', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          note: { type: DataTypes.TEXT, allowNull: true },
          targetPrice: { type: DataTypes.DECIMAL(20, 10), allowNull: true },
          sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          ...timestamps,
        },
        { transaction },
      );
      await queryInterface.addIndex('WatchlistItems', ['portfolioId', 'securityId'], {
        unique: true,
        name: 'WatchlistItems_portfolioId_securityId_unique',
        transaction,
      });
      await queryInterface.addIndex('WatchlistItems', ['securityId'], { transaction });
      await queryInterface.addIndex('WatchlistItems', ['sectionId'], { transaction });

      await queryInterface.createTable(
        'WatchlistAlerts',
        {
          id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
          itemId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'WatchlistItems', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          type: { type: DataTypes.STRING(32), allowNull: false },
          price: { type: DataTypes.DECIMAL(20, 10), allowNull: true },
          percent: { type: DataTypes.DOUBLE, allowNull: true },
          frequency: { type: DataTypes.STRING(32), allowNull: false },
          notifyInApp: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          notifyEmail: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          isArmed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          lastEvaluatedPriceDate: { type: DataTypes.DATEONLY, allowNull: true },
          lastTriggeredAt: { type: DataTypes.DATE, allowNull: true },
          pendingEmailPayload: { type: DataTypes.JSONB, allowNull: true },
          ...timestamps,
        },
        { transaction },
      );
      await queryInterface.addIndex('WatchlistAlerts', ['itemId'], { transaction });
      await queryInterface.sequelize.query(
        `ALTER TABLE "WatchlistAlerts"
           ADD CONSTRAINT "WatchlistAlerts_type_check"
             CHECK ("type" IN ('close_above', 'close_below', 'daily_move')),
           ADD CONSTRAINT "WatchlistAlerts_frequency_check" CHECK ("frequency" IN ('once', 'every_time')),
           ADD CONSTRAINT "WatchlistAlerts_threshold_check"
             CHECK (CASE WHEN "type" = 'daily_move' THEN "percent" IS NOT NULL AND "price" IS NULL
                         ELSE "price" IS NOT NULL AND "percent" IS NULL END);`,
        { transaction },
      );

      await queryInterface.addColumn(
        'Securities',
        'securityType',
        { type: DataTypes.STRING(32), allowNull: true },
        { transaction },
      );
      await queryInterface.sequelize.query(
        `UPDATE "Securities" SET "securityType" = 'crypto' WHERE "assetClass" = 'crypto'`,
        { transaction },
      );
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('Securities', 'securityType', { transaction });
      await queryInterface.dropTable('WatchlistAlerts', { transaction });
      await queryInterface.dropTable('WatchlistItems', { transaction });
      await queryInterface.dropTable('WatchlistSections', { transaction });
    });
  },
};
