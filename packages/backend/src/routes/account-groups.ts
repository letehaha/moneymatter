import * as accountGroupController from '@controllers/account-groups';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router();

router.use(authenticateSession);

router.post('/', checkBaseCurrencyLock, accountGroupController.createAccountGroup);

router.get('/', accountGroupController.getGroups);

router.put('/:groupId', checkBaseCurrencyLock, accountGroupController.updateGroup);

router.delete('/:groupId', checkBaseCurrencyLock, accountGroupController.deleteGroup);

router.post('/:groupId/add-account/:accountId', checkBaseCurrencyLock, accountGroupController.addAccountToGroup);

router.delete('/:groupId/accounts', checkBaseCurrencyLock, accountGroupController.removeAccountFromGroup);

router.put('/:groupId/move', checkBaseCurrencyLock, accountGroupController.moveAccountToGroup);

router.get('/:groupId/accounts', accountGroupController.getAccountsInGroup);

export default router;
