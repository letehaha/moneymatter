import { FEATURES } from '@bt/shared/types';
import connectProvider from '@controllers/bank-data-providers/connections/connect-provider';
import connectSelectedAccounts from '@controllers/bank-data-providers/connections/connect-selected-accounts';
import disconnectProvider from '@controllers/bank-data-providers/connections/disconnect-provider';
import getConnectionDetails from '@controllers/bank-data-providers/connections/get-connection-details';
import getSyncJobProgress from '@controllers/bank-data-providers/connections/get-sync-job-progress';
import listActiveSyncJobs from '@controllers/bank-data-providers/connections/list-active-sync-jobs';
import listExternalAccounts from '@controllers/bank-data-providers/connections/list-external-accounts';
import listUserConnections from '@controllers/bank-data-providers/connections/list-user-connections';
import loadTransactionsForPeriod from '@controllers/bank-data-providers/connections/load-transactions-for-period';
import reauthorizeConnection from '@controllers/bank-data-providers/connections/reauthorize-connection';
import reconcileDuplicatesForAccount from '@controllers/bank-data-providers/connections/reconcile-duplicates-for-account';
import syncConnection from '@controllers/bank-data-providers/connections/sync-connection';
import syncTransactionsForAccount from '@controllers/bank-data-providers/connections/sync-transactions-for-account';
import updateConnectionDetails from '@controllers/bank-data-providers/connections/update-connection-details';
import listBanks from '@controllers/bank-data-providers/enablebanking/list-banks';
import listCountries from '@controllers/bank-data-providers/enablebanking/list-countries';
import oauthCallback from '@controllers/bank-data-providers/enablebanking/oauth-callback';
import * as providersController from '@controllers/bank-data-providers/providers.controller';
import checkSync from '@controllers/bank-data-providers/sync/check-sync';
import getSyncStatus from '@controllers/bank-data-providers/sync/get-sync-status';
import triggerSync from '@controllers/bank-data-providers/sync/trigger-sync';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { requireFeature } from '@middlewares/entitlements';
import express from 'express';

const router = express.Router();

// Provider discovery
router.get('/', authenticateSession, providersController.listProviders);

// Connection management
router.get('/connections', authenticateSession, listUserConnections);
router.get('/connections/:connectionId', authenticateSession, getConnectionDetails);
router.post(
  '/:providerType/connect',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  connectProvider,
);
router.delete(
  '/connections/:connectionId',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  disconnectProvider,
);
router.post(
  '/connections/:connectionId/reauthorize',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  reauthorizeConnection,
);
router.patch(
  '/connections/:connectionId',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  updateConnectionDetails,
);

// Account sync flow
router.get(
  '/connections/:connectionId/available-accounts',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  listExternalAccounts,
);
router.post(
  '/connections/:connectionId/sync-selected-accounts',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  connectSelectedAccounts,
);

// Transactions sync
router.post(
  '/connections/:connectionId/sync-transactions',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  syncTransactionsForAccount,
);
router.post(
  '/connections/:connectionId/sync',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  syncConnection,
);
router.post(
  '/connections/:connectionId/reconcile-duplicates',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  reconcileDuplicatesForAccount,
);
router.post(
  '/connections/:connectionId/load-transactions-for-period',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  loadTransactionsForPeriod,
);
router.get('/connections/:connectionId/sync-job-progress', authenticateSession, getSyncJobProgress);
router.get('/active-sync-jobs', authenticateSession, listActiveSyncJobs);

// Bulk account sync endpoints
router.get('/sync/check', authenticateSession, requireFeature(FEATURES.bank_providers), blockDemoUsers, checkSync);
router.post(
  '/sync/trigger',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  triggerSync,
);
router.get('/sync/status', authenticateSession, blockDemoUsers, getSyncStatus);

// Enable Banking specific endpoints
router.post(
  '/enablebanking/countries',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  listCountries,
);
router.post(
  '/enablebanking/banks',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  listBanks,
);
router.post(
  '/enablebanking/oauth-callback',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  oauthCallback,
);

export default router;
