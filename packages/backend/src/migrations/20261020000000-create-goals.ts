import { DataTypes, QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'Goals',
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
          name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
          currencyCode: {
            type: DataTypes.STRING(3),
            allowNull: false,
            references: { model: 'Currencies', key: 'code' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
          },
          targetAmount: {
            type: DataTypes.BIGINT,
            allowNull: false,
            comment: 'Cents in currencyCode',
          },
          targetDate: {
            type: DataTypes.DATEONLY,
            allowNull: true,
          },
          plannedMonthly: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Cents per month in currencyCode',
          },
          status: {
            type: DataTypes.STRING(20),
            allowNull: false,
            defaultValue: 'active',
          },
          achievedAt: {
            type: DataTypes.DATE,
            allowNull: true,
          },
          achievedAmount: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Cents in currencyCode, the value when the goal was first reached',
          },
          sortOrder: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
          logoDomain: {
            type: DataTypes.STRING(253),
            allowNull: true,
          },
          logoInitials: {
            type: DataTypes.STRING(16),
            allowNull: true,
          },
          logoColor: {
            type: DataTypes.STRING(7),
            allowNull: true,
          },
          logoIcon: {
            type: DataTypes.STRING(64),
            allowNull: true,
          },
          logoImageId: {
            type: DataTypes.UUID,
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

      await queryInterface.addIndex('Goals', ['userId'], { transaction });

      await queryInterface.sequelize.query(
        `ALTER TABLE "Goals"
           ADD CONSTRAINT "Goals_targetAmount_check" CHECK ("targetAmount" > 0),
           ADD CONSTRAINT "Goals_plannedMonthly_check" CHECK ("plannedMonthly" > 0),
           ADD CONSTRAINT "Goals_status_check" CHECK ("status" IN ('active', 'paused', 'archived')),
           ADD CONSTRAINT "Goals_achieved_check" CHECK (("achievedAt" IS NULL) = ("achievedAmount" IS NULL));`,
        { transaction },
      );

      await queryInterface.createTable(
        'GoalAccounts',
        {
          goalId: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
            references: { model: 'Goals', key: 'id' },
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
          sharePercent: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
            comment: 'Percent of the account balance counted toward the goal',
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('GoalAccounts', ['accountId'], { transaction });

      await queryInterface.sequelize.query(
        `ALTER TABLE "GoalAccounts"
           ADD CONSTRAINT "GoalAccounts_sharePercent_check" CHECK ("sharePercent" > 0 AND "sharePercent" <= 100);`,
        { transaction },
      );
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('GoalAccounts', { transaction });
      await queryInterface.dropTable('Goals', { transaction });
    });
  },
};
