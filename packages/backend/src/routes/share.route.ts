import acceptInvitation from '@controllers/share/accept-invitation';
import backInviteFromInvitation from '@controllers/share/back-invite-from-invitation';
import cancelInvitation from '@controllers/share/cancel-invitation';
import createInvitation from '@controllers/share/create-invitation';
import declineInvitation from '@controllers/share/decline-invitation';
import leaveShare from '@controllers/share/leave-share';
import listMembers from '@controllers/share/list-members';
import listReceivedInvitations from '@controllers/share/list-received-invitations';
import listSentInvitations from '@controllers/share/list-sent-invitations';
import listSharedWithMe from '@controllers/share/list-shared-with-me';
import resendInvitation from '@controllers/share/resend-invitation';
import revokeMember from '@controllers/share/revoke-member';
import updateMember from '@controllers/share/update-member';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { shareInvitationSendRateLimit } from '@middlewares/rate-limit';
import { Router } from 'express';

const router = Router({});

router.post(
  '/invitations',
  authenticateSession,
  blockDemoUsers,
  checkBaseCurrencyLock,
  shareInvitationSendRateLimit,
  createInvitation,
);
router.get('/invitations/sent', authenticateSession, listSentInvitations);
router.get('/invitations/received', authenticateSession, listReceivedInvitations);
router.post('/invitations/:token/accept', authenticateSession, blockDemoUsers, checkBaseCurrencyLock, acceptInvitation);
router.post(
  '/invitations/:token/decline',
  authenticateSession,
  blockDemoUsers,
  checkBaseCurrencyLock,
  declineInvitation,
);
router.post('/invitations/:id/resend', authenticateSession, blockDemoUsers, checkBaseCurrencyLock, resendInvitation);
router.delete('/invitations/:id', authenticateSession, blockDemoUsers, checkBaseCurrencyLock, cancelInvitation);
router.post(
  '/invitations/:id/back-invite',
  authenticateSession,
  blockDemoUsers,
  checkBaseCurrencyLock,
  shareInvitationSendRateLimit,
  backInviteFromInvitation,
);

router.get('/resources/:resourceType/:resourceId/members', authenticateSession, listMembers);
router.patch(
  '/resources/:resourceType/:resourceId/members/:userId',
  authenticateSession,
  blockDemoUsers,
  checkBaseCurrencyLock,
  updateMember,
);
router.delete(
  '/resources/:resourceType/:resourceId/members/:userId',
  authenticateSession,
  blockDemoUsers,
  checkBaseCurrencyLock,
  revokeMember,
);

router.get('/shared-with-me', authenticateSession, listSharedWithMe);
router.post(
  '/shared-with-me/:resourceType/:resourceId/leave',
  authenticateSession,
  blockDemoUsers,
  checkBaseCurrencyLock,
  leaveShare,
);

export default router;
