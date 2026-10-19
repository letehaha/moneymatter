import { getLogoImageController } from '@controllers/logo-images.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { Router } from 'express';

const router = Router({});

// Any signed-in user, not owner-scoped: trackers can be shared, and ids are unguessable UUIDs.
router.get('/:id', authenticateSession, getLogoImageController);

export default router;
