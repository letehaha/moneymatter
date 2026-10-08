import { FEATURES } from '@bt/shared/types';
import { deleteAttachmentController, getAttachmentFileController } from '@controllers/attachments.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { requireFeature } from '@middlewares/entitlements';
import { Router } from 'express';

const router = Router({});

// Downloading stays ungated so a lapsed user can still reach their own files.
router.get('/:id/file', authenticateSession, getAttachmentFileController);

router.delete('/:id', authenticateSession, requireFeature(FEATURES.attachments), deleteAttachmentController);

export default router;
