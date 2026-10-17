import { DataTypes, QueryInterface } from 'sequelize';

/**
 * "PushSubscriptions": one Web Push subscription per browser profile. "endpoint" is unique across
 * users, so a browser handed to another account moves its row instead of keeping two. Rows cascade
 * with the user.
 *
 * `down` drops the table with every subscription in it; users re-enable push on each device.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'PushSubscriptions',
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
          endpoint: {
            type: DataTypes.TEXT,
            allowNull: false,
            unique: true,
          },
          p256dh: {
            type: DataTypes.STRING(128),
            allowNull: false,
          },
          auth: {
            type: DataTypes.STRING(64),
            allowNull: false,
          },
          vapidKeyId: {
            type: DataTypes.STRING(16),
            allowNull: false,
            comment: 'First 16 hex characters of SHA-256 over the VAPID public key used to subscribe',
          },
          expirationTime: {
            type: DataTypes.DATE,
            allowNull: true,
          },
          userAgent: {
            type: DataTypes.STRING(512),
            allowNull: true,
          },
          deviceLabel: {
            type: DataTypes.STRING(100),
            allowNull: true,
          },
          lastSeenAt: {
            type: DataTypes.DATE,
            allowNull: true,
          },
          lastSuccessAt: {
            type: DataTypes.DATE,
            allowNull: true,
          },
          lastFailureAt: {
            type: DataTypes.DATE,
            allowNull: true,
          },
          failureCount: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Consecutive "rejected" sends; any success resets it',
          },
          lastFailureStatus: {
            type: DataTypes.INTEGER,
            allowNull: true,
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

      await queryInterface.addIndex('PushSubscriptions', ['userId'], { transaction });
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable('PushSubscriptions');
  },
};
