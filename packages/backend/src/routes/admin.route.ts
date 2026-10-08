import { adminUpdateUserPlan } from '@controllers/admin.controller';
import { adminOnly } from '@middlewares/admin-only';
import { authenticateSession } from '@middlewares/better-auth';
import { Router } from 'express';

const router = Router();

router.patch('/users/:id/plan', authenticateSession, adminOnly, adminUpdateUserPlan);

export default router;
