import { aiMapCategoriesController } from '@controllers/import-export/ai-map-categories.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { Router } from 'express';

const router = Router({});

/**
 * Ask AI to match imported source category names to the user's existing categories
 * POST /import/ai-map-categories
 */
router.post('/ai-map-categories', authenticateSession, blockDemoUsers, aiMapCategoriesController);

export default router;
