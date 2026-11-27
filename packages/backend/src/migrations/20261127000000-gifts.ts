import { DataTypes, QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'Gifts',
        {
          id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
          code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
          tier: { type: DataTypes.STRING(20), allowNull: false },
          buyerName: { type: DataTypes.STRING(100), allowNull: false },
          buyerEmail: { type: DataTypes.STRING(320), allowNull: false },
          recipientName: { type: DataTypes.STRING(100), allowNull: false },
          recipientEmail: { type: DataTypes.STRING(320), allowNull: false },
          message: { type: DataTypes.TEXT, allowNull: true },
          deliverAt: { type: DataTypes.DATE, allowNull: false },
          sentAt: { type: DataTypes.DATE, allowNull: true },
          redeemedAt: { type: DataTypes.DATE, allowNull: true },
          redeemedByUserId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'Users', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          refundedAt: { type: DataTypes.DATE, allowNull: true },
          stripeCheckoutSessionId: { type: DataTypes.STRING, allowNull: false, unique: true },
          stripePaymentIntentId: { type: DataTypes.STRING, allowNull: true },
          createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
          updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        { transaction },
      );
      await queryInterface.addIndex('Gifts', ['stripePaymentIntentId'], { transaction });
      await queryInterface.addIndex('Gifts', ['deliverAt'], { where: { sentAt: null }, transaction });
      await queryInterface.addColumn(
        'BillingSubscriptions',
        'currentPeriodStartsAt',
        { type: DataTypes.DATE, allowNull: true },
        { transaction },
      );
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('BillingSubscriptions', 'currentPeriodStartsAt', { transaction });
      await queryInterface.dropTable('Gifts', { transaction });
    });
  },
};
