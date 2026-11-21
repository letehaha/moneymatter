import { DataTypes, QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.changeColumn(
        'GoalAccounts',
        'sharePercent',
        {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          comment: 'Percent of the account balance left after fixed amounts; null for a fixed amount',
        },
        { transaction },
      );
      await queryInterface.addColumn(
        'GoalAccounts',
        'fixedAmount',
        {
          type: DataTypes.BIGINT,
          allowNull: true,
          comment: "Cents in the account's currency, taken from the balance before any percent share",
        },
        { transaction },
      );
      await queryInterface.addColumn(
        'GoalAccounts',
        'fixedPosition',
        {
          type: DataTypes.INTEGER,
          allowNull: true,
          comment: "Order of the account's fixed amounts; lower is filled first",
        },
        { transaction },
      );
      await queryInterface.addColumn(
        'Goals',
        'reachedHoldDays',
        {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 30,
          comment: 'Days after reaching the target during which a dip below it keeps the goal reached',
        },
        { transaction },
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE "GoalAccounts"
           ADD CONSTRAINT "GoalAccounts_fixedAmount_check" CHECK ("fixedAmount" > 0),
           ADD CONSTRAINT "GoalAccounts_kind_check" CHECK (
             ("sharePercent" IS NULL) <> ("fixedAmount" IS NULL)
             AND ("fixedAmount" IS NULL) = ("fixedPosition" IS NULL)
           );
         ALTER TABLE "Goals"
           ADD CONSTRAINT "Goals_reachedHoldDays_check" CHECK ("reachedHoldDays" BETWEEN 0 AND 365);`,
        { transaction },
      );
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`DELETE FROM "GoalAccounts" WHERE "fixedAmount" IS NOT NULL;`, {
        transaction,
      });
      await queryInterface.sequelize.query(
        `ALTER TABLE "GoalAccounts"
           DROP CONSTRAINT "GoalAccounts_kind_check",
           DROP CONSTRAINT "GoalAccounts_fixedAmount_check";
         ALTER TABLE "Goals" DROP CONSTRAINT "Goals_reachedHoldDays_check";`,
        { transaction },
      );
      await queryInterface.removeColumn('Goals', 'reachedHoldDays', { transaction });
      await queryInterface.removeColumn('GoalAccounts', 'fixedPosition', { transaction });
      await queryInterface.removeColumn('GoalAccounts', 'fixedAmount', { transaction });
      await queryInterface.changeColumn(
        'GoalAccounts',
        'sharePercent',
        {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: false,
          comment: 'Percent of the account balance counted toward the goal',
        },
        { transaction },
      );
    });
  },
};
