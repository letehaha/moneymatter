import { CHAT_ATTACHMENT_MAX_BYTES } from '@bt/shared/types';
import getAttachmentImage from '@controllers/chat/attachments/get-attachment-image.controller';
import uploadAttachment from '@controllers/chat/attachments/upload-attachment.controller';
import { updateChatSettings } from '@controllers/chat/settings.controller';
import createThread from '@controllers/chat/threads/create-thread.controller';
import deleteThread from '@controllers/chat/threads/delete-thread.controller';
import getDefaultConnection from '@controllers/chat/threads/get-default-connection.controller';
import getThread from '@controllers/chat/threads/get-thread.controller';
import listThreads from '@controllers/chat/threads/list-threads.controller';
import updateThread from '@controllers/chat/threads/update-thread.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { chatAttachmentRateLimit } from '@middlewares/rate-limit';
import express, { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

// Threads, retention and attachments hold no monetary data, so they carry no `checkBaseCurrencyLock`.
//
// A read-only (lapsed plan) user may use these writes too; the allowed set lives in
// `READ_ONLY_ROUTE_PATTERNS` (`middlewares/entitlements.ts`).

router.get('/default-connection', getDefaultConnection);
router.get('/threads', listThreads);
router.post('/threads', blockDemoUsers, createThread);
router.get('/threads/:id', getThread);
router.patch('/threads/:id', updateThread);
router.delete('/threads/:id', deleteThread);

// The body is the file, so the route has its own parser. It sits behind the guards and the rate
// limit so a refused request is answered before up to 10 MB is buffered.
router.post(
  '/threads/:id/attachments',
  blockDemoUsers,
  chatAttachmentRateLimit,
  express.raw({ type: 'application/octet-stream', limit: CHAT_ATTACHMENT_MAX_BYTES }),
  uploadAttachment,
);
router.get('/attachments/:id/image', getAttachmentImage);

router.put('/settings', updateChatSettings);

export default router;
