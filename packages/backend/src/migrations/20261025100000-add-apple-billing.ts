import { DataTypes, QueryInterface, Transaction } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'Users',
        'appStoreAccountToken',
        {
          type: DataTypes.UUID,
          allowNull: false,
          defaultValue: queryInterface.sequelize.literal('gen_random_uuid()'),
        },
        { transaction: t },
      );
      await queryInterface.addIndex('Users', ['appStoreAccountToken'], { unique: true, transaction: t });

      await queryInterface.addColumn(
        'BillingSubscriptions',
        'provider',
        { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'stripe' },
        { transaction: t },
      );

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeColumn('BillingSubscriptions', 'provider', { transaction: t });
      await queryInterface.removeColumn('Users', 'appStoreAccountToken', { transaction: t });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
