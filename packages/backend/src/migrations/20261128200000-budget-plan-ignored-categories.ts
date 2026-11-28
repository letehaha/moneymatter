import { DataTypes, QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.addColumn('BudgetPlans', 'ignoredCategoryIds', {
      type: DataTypes.ARRAY(DataTypes.UUID),
      allowNull: false,
      defaultValue: [],
      comment: 'Categories (with their subtrees) left out of the spending-outside-lines list',
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn('BudgetPlans', 'ignoredCategoryIds');
  },
};
