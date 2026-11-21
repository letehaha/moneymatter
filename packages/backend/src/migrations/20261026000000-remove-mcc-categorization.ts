import { DataTypes, QueryInterface, Transaction } from 'sequelize';

/**
 * Drop the MCC → category mappings and clear the `mcc_rule` stamps they left on
 * transactions, so those rows become AI categorization candidates again.
 * `down` recreates both tables empty; the MCC seed rows are not restored.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `UPDATE "Transactions" SET "categorizationMeta" = NULL WHERE "categorizationMeta"->>'source' = 'mcc_rule'`,
        { transaction: t },
      );
      await queryInterface.dropTable('UserMerchantCategoryCodes', { transaction: t });
      await queryInterface.dropTable('MerchantCategoryCodes', { transaction: t });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'MerchantCategoryCodes',
        {
          id: { type: DataTypes.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
          code: { type: DataTypes.INTEGER, allowNull: false },
          name: { type: DataTypes.STRING, allowNull: false },
          description: { type: DataTypes.STRING(1000), allowNull: true },
        },
        { transaction: t },
      );

      await queryInterface.createTable(
        'UserMerchantCategoryCodes',
        {
          id: {
            type: DataTypes.UUID,
            allowNull: false,
            primaryKey: true,
            defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
          },
          categoryId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'Categories', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          mccId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'MerchantCategoryCodes', key: 'id' },
          },
          userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'Users', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        },
        { transaction: t },
      );

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
