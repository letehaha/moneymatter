import { DataTypes, QueryInterface } from 'sequelize';

/**
 * `batchId` is the `externalData.importDetails.batchId` stamped on transactions. It is
 * unique per user only: restoring a backup into another user copies stamps verbatim.
 * `absorbedAmount` is signed cents in the account's own currency.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'ImportBatches',
        {
          id: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
          },
          userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Users', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          batchId: {
            type: DataTypes.UUID,
            allowNull: false,
          },
          source: {
            type: DataTypes.STRING,
            allowNull: false,
          },
          importedAt: {
            type: DataTypes.DATE,
            allowNull: false,
          },
          finishedAt: {
            type: DataTypes.DATE,
            allowNull: true,
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('ImportBatches', ['userId', 'batchId'], { unique: true, transaction });

      await queryInterface.createTable(
        'ImportBatchAccountEffects',
        {
          importBatchId: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
            references: { model: 'ImportBatches', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          accountId: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
            references: { model: 'Accounts', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          absorbedAmount: {
            type: DataTypes.BIGINT,
            allowNull: false,
            defaultValue: 0,
          },
          createdByImport: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('ImportBatchAccountEffects', ['accountId'], { transaction });
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('ImportBatchAccountEffects', { transaction });
      await queryInterface.dropTable('ImportBatches', { transaction });
    });
  },
};
