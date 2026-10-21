import { CHAT_ATTACHMENT_MAX_BYTES } from '@bt/shared/types';
import getAttachmentImage from '@controllers/chat/attachments/get-attachment-image.controller';
import uploadAttachment from '@controllers/chat/attachments/upload-attachment.controller';
import sendMessage from '@controllers/chat/messages/send-message.controller';
import approveAll from '@controllers/chat/proposals/approve-all.controller';
import approveProposal from '@controllers/chat/proposals/approve-proposal.controller';
import commentProposal from '@controllers/chat/proposals/comment-proposal.controller';
import editProposal from '@controllers/chat/proposals/edit-proposal.controller';
import getProposal from '@controllers/chat/proposals/get-proposal.controller';
import listApplied from '@controllers/chat/proposals/list-applied.controller';
import refreshProposal from '@controllers/chat/proposals/refresh-proposal.controller';
import rejectProposal from '@controllers/chat/proposals/reject-proposal.controller';
import cancelRun from '@controllers/chat/runs/cancel-run.controller';
import streamRunEvents from '@controllers/chat/runs/stream-run-events.controller';
import { updateChatSettings } from '@controllers/chat/settings.controller';
import createThread from '@controllers/chat/threads/create-thread.controller';
import deleteThread from '@controllers/chat/threads/delete-thread.controller';
import getDefaultConnection from '@controllers/chat/threads/get-default-connection.controller';
import getThread from '@controllers/chat/threads/get-thread.controller';
import listThreads from '@controllers/chat/threads/list-threads.controller';
import updateThread from '@controllers/chat/threads/update-thread.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { chatApprovalRateLimit, chatAttachmentRateLimit, chatMessageRateLimit } from '@middlewares/rate-limit';
import express, { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

// Threads, retention, runs and the edits of a card hold no monetary data, so they carry no
// `checkBaseCurrencyLock`. The two routes that apply cards to the user's finances (approve and
// approve all) are the guarded ones.
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

// A message starts a run that executes detached from the request; its events stream from the run route.
router.post('/threads/:id/messages', blockDemoUsers, chatMessageRateLimit, sendMessage);
router.get('/runs/:runId/events', streamRunEvents);
router.post('/runs/:runId/cancel', cancelRun);

// Cards. Reading, refreshing, rejecting and commenting write no financial data; a lapsed plan keeps
// them (`READ_ONLY_ROUTE_PATTERNS`). Editing and approving are writes: `enforceReadOnly` answers 402.
router.get('/proposals/:id', getProposal);
router.patch('/proposals/:id', blockDemoUsers, editProposal);
router.post('/proposals/:id/refresh', refreshProposal);
router.post('/proposals/:id/approve', blockDemoUsers, checkBaseCurrencyLock, chatApprovalRateLimit, approveProposal);
router.post('/proposals/:id/reject', rejectProposal);
router.post('/proposals/:id/comment', blockDemoUsers, chatMessageRateLimit, commentProposal);
router.post('/messages/:id/approve-all', blockDemoUsers, checkBaseCurrencyLock, chatApprovalRateLimit, approveAll);
router.get('/applied', listApplied);

router.put('/settings', updateChatSettings);

export default router;
