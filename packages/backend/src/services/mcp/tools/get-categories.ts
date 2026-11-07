import { getCategories } from '@services/categories.service';

import { defineTool } from '../define-tool';

export const getCategoriesTool = defineTool({
  name: 'get_categories',
  toolset: 'core',
  access: 'read',
  description:
    'List all transaction categories. Returns category ID, name, color, icon, type (income/expense), and parent ID for hierarchical categories.',
  run: async ({ userId }) => {
    const categories = await getCategories({ userId });

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      type: c.type,
      parentId: c.parentId,
    }));
  },
});
