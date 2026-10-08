import { DataTypes, QueryInterface, Transaction } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      // Per-Category default tags, applied client-side by the transaction form.
      // CASCADE on both FKs: deleting a tag drops it from every Category rule,
      // deleting a Category drops its rule rows.
      await queryInterface.createTable(
        'CategoryTags',
        {
          categoryId: {
            type: DataTypes.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'Categories', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          tagId: {
            type: DataTypes.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'Tags', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        },
        { transaction: t },
      );

      await queryInterface.addIndex('CategoryTags', ['tagId'], {
        name: 'category_tags_tag_id_idx',
        transaction: t,
      });

      // Opt-in: AI categorization also stamps the category's default tags onto the row.
      await queryInterface.addColumn(
        'Categories',
        'applyDefaultTagsOnAiCategorization',
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        { transaction: t },
      );

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn('Categories', 'applyDefaultTagsOnAiCategorization');
    await queryInterface.dropTable('CategoryTags');
  },
};
