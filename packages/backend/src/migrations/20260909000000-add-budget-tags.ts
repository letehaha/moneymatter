import { DataTypes, QueryInterface, Transaction } from 'sequelize';

/**
 * Migration to add tag-based budgeting support.
 *
 * Changes:
 * 1. Adds 'tag' to the `type` enum on Budgets ('manual' | 'category' | 'tag')
 * 2. Creates BudgetTags junction table for the many-to-many relationship with Tags
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    // PostgreSQL doesn't allow ALTER TYPE ADD VALUE inside a transaction
    await queryInterface.sequelize.query(`ALTER TYPE "enum_Budgets_type" ADD VALUE IF NOT EXISTS 'tag';`);

    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      // Create BudgetTags junction table
      await queryInterface.createTable(
        'BudgetTags',
        {
          budgetId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: 'Budgets',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          tagId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: 'Tags',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        },
        { transaction: t },
      );

      // Composite primary key for the junction table
      await queryInterface.addConstraint('BudgetTags', {
        fields: ['budgetId', 'tagId'],
        type: 'primary key',
        name: 'budget_tags_pkey',
        transaction: t,
      });

      // Index for efficient lookup by budgetId
      await queryInterface.addIndex('BudgetTags', ['budgetId'], {
        name: 'budget_tags_budget_id_idx',
        transaction: t,
      });

      // Index for efficient lookup by tagId (reverse direction)
      await queryInterface.addIndex('BudgetTags', ['tagId'], {
        name: 'budget_tags_tag_id_idx',
        transaction: t,
      });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    // Revert any tag budgets back to manual so the data is valid after
    // dropping BudgetTags and removing the enum value
    await queryInterface.sequelize.query(`UPDATE "Budgets" SET type = 'manual' WHERE type = 'tag';`);

    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      const budgetTagsExists = await queryInterface.tableExists('BudgetTags');
      if (budgetTagsExists) {
        await queryInterface.removeConstraint('BudgetTags', 'budget_tags_pkey', { transaction: t });
        await queryInterface.dropTable('BudgetTags', { transaction: t });
      }

      // PostgreSQL doesn't support dropping individual enum values directly.
      // Recreate the enum without 'tag'.
      await queryInterface.sequelize.query(`CREATE TYPE "enum_Budgets_type_new" AS ENUM ('manual', 'category');`, {
        transaction: t,
      });
      // Drop the default before changing the column type, otherwise PostgreSQL
      // cannot cast the default value to the new enum automatically.
      await queryInterface.sequelize.query(`ALTER TABLE "Budgets" ALTER COLUMN type DROP DEFAULT;`, {
        transaction: t,
      });
      await queryInterface.sequelize.query(
        `ALTER TABLE "Budgets" ALTER COLUMN type TYPE "enum_Budgets_type_new" USING type::text::"enum_Budgets_type_new";`,
        { transaction: t },
      );
      await queryInterface.sequelize.query(`DROP TYPE "enum_Budgets_type";`, { transaction: t });
      await queryInterface.sequelize.query(`ALTER TYPE "enum_Budgets_type_new" RENAME TO "enum_Budgets_type";`, {
        transaction: t,
      });
      // Restore the default
      await queryInterface.sequelize.query(
        `ALTER TABLE "Budgets" ALTER COLUMN type SET DEFAULT 'manual'::"enum_Budgets_type";`,
        { transaction: t },
      );

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
