import { DataTypes, QueryInterface } from 'sequelize';

/**
 * Eight tables of the budget-plan ledger. Names carry a `Budget*` prefix without
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
          poolFrom: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'First Ready-to-Assign pool period start; NULL = no pool',
          },
          zeroSum: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Keep Ready to Assign at 0: the header nags until the pool is fully assigned',
          },
          expectedIncome: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Cents per period, user-entered',
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
           ADD CONSTRAINT "BudgetPlans_cadence_check"
             CHECK ("cadence" IN ('days', 'months', 'semi_monthly')),
           ADD CONSTRAINT "BudgetPlans_intervalN_check" CHECK ("intervalN" >= 1),
           ADD CONSTRAINT "BudgetPlans_semiMonthly_interval_check"
             CHECK ("cadence" <> 'semi_monthly' OR "intervalN" = 1),
           ADD CONSTRAINT "BudgetPlans_semiMonthly_secondAnchorDay_check"
             CHECK (("cadence" = 'semi_monthly') = ("secondAnchorDay" IS NOT NULL)),
           ADD CONSTRAINT "BudgetPlans_secondAnchorDay_range_check"
             CHECK ("secondAnchorDay" BETWEEN 1 AND 31),
           ADD CONSTRAINT "BudgetPlans_carryPolicy_check"
             CHECK ("carryPolicy" IN ('none', 'floor', 'signed')),
           ADD CONSTRAINT "BudgetPlans_zeroSum_check"
             CHECK (NOT "zeroSum" OR "poolFrom" IS NOT NULL);`,
        { transaction },
      );

      // Anchors the early adopter budgeting trial. Set once, never reset by plan delete, purge, wipe or restore.
      await queryInterface.addColumn(
        'Users',
        'firstBudgetPlanAt',
        { type: DataTypes.DATE, allowNull: true },
        { transaction },
      );

      await queryInterface.createTable(
        'BudgetLineGroups',
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

      await queryInterface.addIndex('BudgetLineGroups', ['planId'], { transaction });

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
          groupId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: { model: 'BudgetLineGroups', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
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
          archivedCategoryIds: {
            type: DataTypes.ARRAY(DataTypes.UUID),
            allowNull: false,
            defaultValue: [],
            comment: 'Categories an archived line held at its end, which a restore brings back',
          },
          origin: {
            type: DataTypes.STRING(16),
            allowNull: false,
            defaultValue: 'manual',
            comment: "What created the line: 'manual', 'rules' (spending-based suggestion) or 'ai'",
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
      await queryInterface.addIndex('BudgetLines', ['groupId'], { transaction });

      await queryInterface.sequelize.query(
        `ALTER TABLE "BudgetLines" ADD CONSTRAINT "BudgetLines_lifetime_check"
         CHECK ("activeUntil" IS NULL OR "activeUntil" >= "activeFrom"),
         ADD CONSTRAINT "BudgetLines_origin_check" CHECK ("origin" IN ('manual', 'rules', 'ai'));`,
        { transaction },
      );

      await queryInterface.createTable(
        'BudgetLineGoals',
        {
          id: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
          },
          lineId: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
            references: { model: 'BudgetLines', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          frequency: {
            type: DataTypes.STRING(20),
            allowNull: false,
            comment: 'BudgetLineGoalFrequency: every_period | weekly | biweekly | yearly | by_date | open_ended',
          },
          behavior: {
            type: DataTypes.STRING(20),
            allowNull: false,
            comment: 'BudgetLineGoalBehavior: budget_another | refill_up_to | reach_balance',
          },
          amount: {
            type: DataTypes.BIGINT,
            allowNull: false,
            comment: 'Cents',
          },
          weekday: {
            type: DataTypes.SMALLINT,
            allowNull: true,
            comment: 'weekly only; 0 is Sunday',
          },
          anchorDate: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'biweekly: a first occurrence; yearly: the first due date; by_date: the due date',
          },
          repeatEvery: {
            type: DataTypes.SMALLINT,
            allowNull: true,
          },
          repeatUnit: {
            type: DataTypes.STRING(10),
            allowNull: true,
            comment: 'BudgetLineGoalRepeatUnit: months | years',
          },
          stopAtBalance: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Cents; budget_another only',
          },
          fundingCap: {
            type: DataTypes.BIGINT,
            allowNull: true,
            comment: 'Cents per period; refill_up_to only',
          },
          startPeriodStart: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'Start of the period the goal was created in',
          },
          snoozedPeriodStart: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'Start of the one period the goal sits out',
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

      await queryInterface.sequelize.query(
        `ALTER TABLE "BudgetLineGoals"
           ADD CONSTRAINT "BudgetLineGoals_behavior_check"
             CHECK ("behavior" IN ('budget_another', 'refill_up_to', 'reach_balance')),
           ADD CONSTRAINT "BudgetLineGoals_amount_check" CHECK ("amount" > 0),
           ADD CONSTRAINT "BudgetLineGoals_frequency_check"
             CHECK ("frequency" IN ('every_period', 'weekly', 'biweekly', 'yearly', 'by_date', 'open_ended')),
           ADD CONSTRAINT "BudgetLineGoals_pairing_check"
             CHECK (CASE "frequency"
               WHEN 'by_date' THEN TRUE
               WHEN 'open_ended' THEN "behavior" = 'reach_balance'
               ELSE "behavior" IN ('budget_another', 'refill_up_to')
             END),
           ADD CONSTRAINT "BudgetLineGoals_weekday_check"
             CHECK (("weekday" IS NOT NULL) = ("frequency" = 'weekly') AND ("weekday" IS NULL OR "weekday" BETWEEN 0 AND 6)),
           ADD CONSTRAINT "BudgetLineGoals_anchorDate_check"
             CHECK (("anchorDate" IS NOT NULL) = ("frequency" IN ('biweekly', 'yearly', 'by_date'))),
           ADD CONSTRAINT "BudgetLineGoals_repeat_check"
             CHECK (
               ("repeatEvery" IS NULL AND "repeatUnit" IS NULL)
               OR ("frequency" = 'by_date'
                 AND "behavior" IN ('budget_another', 'refill_up_to')
                 AND (("repeatUnit" = 'months' AND "repeatEvery" BETWEEN 1 AND 11)
                   OR ("repeatUnit" = 'years' AND "repeatEvery" BETWEEN 1 AND 5)))
             ),
           ADD CONSTRAINT "BudgetLineGoals_stopAtBalance_check"
             CHECK ("stopAtBalance" IS NULL OR ("behavior" = 'budget_another' AND "stopAtBalance" > 0)),
           ADD CONSTRAINT "BudgetLineGoals_fundingCap_check"
             CHECK ("fundingCap" IS NULL OR ("behavior" = 'refill_up_to' AND "fundingCap" > 0)),
           ADD CONSTRAINT "BudgetLineGoals_snooze_check"
             CHECK ("snoozedPeriodStart" IS NULL OR "frequency" <> 'open_ended');`,
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
      await queryInterface.dropTable('BudgetLineGoals', { transaction });
      await queryInterface.dropTable('BudgetLines', { transaction });
      await queryInterface.dropTable('BudgetLineGroups', { transaction });
      await queryInterface.dropTable('BudgetPlans', { transaction });
      await queryInterface.removeColumn('Users', 'firstBudgetPlanAt', { transaction });
    });
  },
};
