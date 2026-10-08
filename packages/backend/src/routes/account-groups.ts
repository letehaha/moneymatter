import * as accountGroupController from '@controllers/account-groups';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router();

router.post('/', authenticateSession, checkBaseCurrencyLock, accountGroupController.createAccountGroup);

router.get('/', authenticateSession, accountGroupController.getGroups);

router.put('/:groupId', authenticateSession, checkBaseCurrencyLock, accountGroupController.updateGroup);

router.delete('/:groupId', authenticateSession, checkBaseCurrencyLock, accountGroupController.deleteGroup);

router.post(
  '/:groupId/add-account/:accountId',
  authenticateSession,
  checkBaseCurrencyLock,
  accountGroupController.addAccountToGroup,
);

router.delete(
  '/:groupId/accounts',
  authenticateSession,
  checkBaseCurrencyLock,
  accountGroupController.removeAccountFromGroup,
);

router.put('/:groupId/move', authenticateSession, checkBaseCurrencyLock, accountGroupController.moveAccountToGroup);

router.get('/:groupId/accounts', authenticateSession, accountGroupController.getAccountsInGroup);

export default router;
