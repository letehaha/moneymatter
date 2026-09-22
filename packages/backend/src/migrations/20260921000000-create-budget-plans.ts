import { DataTypes, QueryInterface } from 'sequelize';

/**
 * Six tables of the budget-plan ledger. Names carry a `Budget*` prefix without
 * colliding with the Trackers feature (`Budgets`, `BudgetCategories`,
 * `BudgetTransactions`).
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'BudgetPlans',
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
            type: DataTypes.STRING(200),
            allowNull: false,
          },
          type: {
            type: DataTypes.STRING(50),
            allowNull: false,
            comment: 'BudgetPlanTypeKey, registry key: category_caps',
          },
          currencyCode: {
            type: DataTypes.STRING(3),
            allowNull: false,
            comment: "The owner's base currency at creation; assigned amounts are in it",
          },
          cadence: {
            type: DataTypes.STRING(20),
            allowNull: false,
            comment: 'BudgetPlanCadence: days | months | semi_monthly',
          },
          intervalN: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
          },
          anchorDate: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'Period boundaries derive from its day, never from the previous boundary',
          },
          secondAnchorDay: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'semi_monthly only',
          },
          epochDate: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'First budgeted day, always a period start',
          },
          carryPolicy: {
            type: DataTypes.STRING(20),
            allowNull: false,
            comment: 'Plan default: none | floor | signed',
          },
          autoAttachAccounts: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
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
          deletedAt: {
            type: DataTypes.DATE,
            allowNull: true,
          },
        },
        { transaction },
      );

      // One active plan per user, race-safe. A soft-deleted plan doesn't block a new one.
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX "BudgetPlans_userId_active_unique"
         ON "BudgetPlans" ("userId") WHERE "deletedAt" IS NULL;`,
        { transaction },
      );

      // The unique index above is partial, so it serves paranoid reads only. Trash
      // listings, the user wipe and the Users cascade check look up by userId alone.
      await queryInterface.addIndex('BudgetPlans', ['userId'], { transaction });

      await queryInterface.sequelize.query(
        `ALTER TABLE "BudgetPlans"
           ADD CONSTRAINT "BudgetPlans_intervalN_check" CHECK ("intervalN" >= 1),
           ADD CONSTRAINT "BudgetPlans_semiMonthly_interval_check"
             CHECK ("cadence" <> 'semi_monthly' OR "intervalN" = 1),
           ADD CONSTRAINT "BudgetPlans_semiMonthly_secondAnchorDay_check"
             CHECK (("cadence" = 'semi_monthly') = ("secondAnchorDay" IS NOT NULL)),
           ADD CONSTRAINT "BudgetPlans_secondAnchorDay_range_check"
             CHECK ("secondAnchorDay" BETWEEN 1 AND 31),
           ADD CONSTRAINT "BudgetPlans_carryPolicy_check"
             CHECK ("carryPolicy" IN ('none', 'floor', 'signed'));`,
        { transaction },
      );

      await queryInterface.createTable(
        'BudgetLines',
        {
          id: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
          },
          planId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'BudgetPlans', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          name: {
            type: DataTypes.STRING(200),
            allowNull: false,
          },
          sortOrder: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
          activeFrom: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'A period start, inclusive',
          },
          activeUntil: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'A period start, exclusive; NULL = still live',
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

      await queryInterface.addIndex('BudgetLines', ['planId'], { transaction });

      await queryInterface.sequelize.query(
        `ALTER TABLE "BudgetLines" ADD CONSTRAINT "BudgetLines_lifetime_check"
         CHECK ("activeUntil" IS NULL OR "activeUntil" > "activeFrom");`,
        { transaction },
      );

      // No unique on (lineId, categoryId): a category can leave a line and come
      // back, so one pair owns several non-overlapping ranges.
      await queryInterface.createTable(
        'BudgetLineCategories',
        {
          id: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
          },
          lineId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'BudgetLines', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          categoryId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'Categories', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          fromDate: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'A period start, inclusive',
          },
          untilDate: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'A period start, exclusive; NULL = still covered',
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

      await queryInterface.addIndex('BudgetLineCategories', ['lineId'], { transaction });
      await queryInterface.addIndex('BudgetLineCategories', ['categoryId'], { transaction });

      await queryInterface.sequelize.query(
        `ALTER TABLE "BudgetLineCategories" ADD CONSTRAINT "BudgetLineCategories_range_check"
         CHECK ("untilDate" IS NULL OR "untilDate" > "fromDate");`,
        { transaction },
      );

      await queryInterface.createTable(
        'BudgetPeriods',
        {
          id: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
          },
          planId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'BudgetPlans', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          startDate: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'Inclusive',
          },
          endDate: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: "Exclusive, equals the next period's start",
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

      // Makes ensurePeriods idempotent under a race.
      await queryInterface.addIndex('BudgetPeriods', ['planId', 'startDate'], {
        unique: true,
        name: 'BudgetPeriods_planId_startDate_unique',
        transaction,
      });

      await queryInterface.sequelize.query(
        `ALTER TABLE "BudgetPeriods" ADD CONSTRAINT "BudgetPeriods_bounds_check"
         CHECK ("endDate" > "startDate");`,
        { transaction },
      );

      await queryInterface.createTable(
        'BudgetAssignments',
        {
          id: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
          },
          periodId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'BudgetPeriods', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          lineId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'BudgetLines', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          baselineAmount: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Cents, from this period on',
          },
          overrideAmount: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Cents, this period only',
          },
          carryPolicy: {
            type: DataTypes.STRING(20),
            allowNull: true,
            comment: 'Carry into this period and later; NULL = inherit',
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

      await queryInterface.addIndex('BudgetAssignments', ['periodId', 'lineId'], {
        unique: true,
        name: 'BudgetAssignments_periodId_lineId_unique',
        transaction,
      });

      // The unique index above is periodId-leading; the merge looks rows up by lineId.
      await queryInterface.addIndex('BudgetAssignments', ['lineId'], { transaction });

      // An all-NULL row carries no intent, so the service deletes it instead of
      // upserting. The CHECK isn't deferrable: compute the final state first.
      await queryInterface.sequelize.query(
        `ALTER TABLE "BudgetAssignments"
           ADD CONSTRAINT "BudgetAssignments_not_empty_check"
             CHECK ("baselineAmount" IS NOT NULL OR "overrideAmount" IS NOT NULL OR "carryPolicy" IS NOT NULL),
           ADD CONSTRAINT "BudgetAssignments_carryPolicy_check"
             CHECK ("carryPolicy" IS NULL OR "carryPolicy" IN ('none', 'floor', 'signed'));`,
        { transaction },
      );

      // No unique on accountId: disjoint account sets across plans are service policy.
      await queryInterface.createTable(
        'BudgetPlanAccounts',
        {
          planId: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
            references: { model: 'BudgetPlans', key: 'id' },
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
        },
        { transaction },
      );

      await queryInterface.addIndex('BudgetPlanAccounts', ['accountId'], { transaction });
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('BudgetPlanAccounts', { transaction });
      await queryInterface.dropTable('BudgetAssignments', { transaction });
      await queryInterface.dropTable('BudgetPeriods', { transaction });
      await queryInterface.dropTable('BudgetLineCategories', { transaction });
      await queryInterface.dropTable('BudgetLines', { transaction });
      await queryInterface.dropTable('BudgetPlans', { transaction });
    });
  },
};
