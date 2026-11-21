import { DataTypes, QueryInterface, Transaction } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'Accounts',
        'defaultPaymentType',
        {
          type: DataTypes.ENUM(
            'bankTransfer',
            'voucher',
            'webPayment',
            'cash',
            'mobilePayment',
            'creditCard',
            'debitCard',
          ),
          allowNull: true,
        },
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `UPDATE "Accounts" SET "defaultPaymentType" = 'creditCard' WHERE "accountCategory" = 'credit-card'`,
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `UPDATE "Accounts" SET "defaultPaymentType" = 'cash' WHERE "accountCategory" = 'cash'`,
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `UPDATE "Accounts" SET "defaultPaymentType" = 'creditCard'
         WHERE "type" = 'monobank' AND "defaultPaymentType" IS NULL`,
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
      await queryInterface.removeColumn('Accounts', 'defaultPaymentType', { transaction: t });
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Accounts_defaultPaymentType";', {
        transaction: t,
      });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
