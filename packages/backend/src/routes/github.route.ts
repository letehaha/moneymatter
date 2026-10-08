import * as githubController from '@controllers/github.controller';
import { Router } from 'express';

const router = Router({});

// Public endpoint - no authentication required
router.get('/activity', githubController.getGitHubActivity);

export default router;
