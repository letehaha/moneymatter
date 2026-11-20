import { createController } from '@controllers/helpers/controller-factory';
import { aiMapImportCategories } from '@services/import-export/core/ai-map-categories.service';
import { z } from 'zod';

export const aiMapCategoriesController = createController(
  z.object({
    body: z.object({
      sourceCategories: z.array(z.string().min(1).max(200)).min(1).max(1000),
    }),
  }),
  async ({ user, body }) => {
    const data = await aiMapImportCategories({ userId: user.id, sourceCategories: body.sourceCategories });
    return { data };
  },
  { inBackground: true },
);
