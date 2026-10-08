import { FEATURES } from '@bt/shared/types';
import { categorizationCandidatesController } from '@controllers/ai-categorization/candidates.controller';
import { categorizationStatusController } from '@controllers/ai-categorization/categorization-status.controller';
import { categorizationHistoryController } from '@controllers/ai-categorization/history.controller';
import { triggerCategorizationController } from '@controllers/ai-categorization/trigger-categorization.controller';
import { activeRestoreStatusController } from '@controllers/backup/active-restore-status.controller';
import { exportBackupController } from '@controllers/backup/export-backup.controller';
import { restoreBackupController } from '@controllers/backup/restore-backup.controller';
import { restoreStatusController } from '@controllers/backup/restore-status.controller';
import addUserCurrencies from '@controllers/currencies/add-user-currencies';
import changeBaseCurrencyStatus from '@controllers/currencies/change-base-currency-status.controller';
import changeBaseCurrency from '@controllers/currencies/change-base-currency.controller';
import editCurrencyExchangeRate from '@controllers/currencies/edit-currency-exchange-rate';
import { exportDataController } from '@controllers/data-export/export-data.controller';
import { getConnectedAppsController, revokeConnectedAppController } from '@controllers/mcp/connected-apps.controller';
import {
  createConnectionController,
  deleteConnectionController,
  getConnectionsController,
  listConnectionModelsController,
  setDefaultConnectionController,
  testConnectionController,
  updateConnectionController,
} from '@controllers/user-settings/ai-connections';
import {
  getCustomInstructionsController,
  setCustomInstructionsController,
} from '@controllers/user-settings/ai-custom-instructions';
import {
  getFeatureConfigController,
  getFeaturesStatus,
  resetFeatureConfigController,
  setFeatureConfigController,
} from '@controllers/user-settings/ai-feature-settings';
import getUserSettings from '@controllers/user-settings/get-settings';
import { getOnboarding, updateOnboarding } from '@controllers/user-settings/onboarding';
import patchUserSettings from '@controllers/user-settings/patch-settings';
import updateUserSettings from '@controllers/user-settings/update-settings';
import {
  deleteUser,
  deleteUserCurrency,
  editUserCurrency,
  getCurrenciesExchangeRates,
  getUser,
  getUserBaseCurrency,
  getUserCurrencies,
  removeUserCurrencyExchangeRate,
  setBaseUserCurrency,
  startFeatureTrial,
  updateUser,
  wipeUserData,
} from '@controllers/user.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { requireFeature, requireFireSettingsAccess } from '@middlewares/entitlements';
import {
  aiConnectionModelsRateLimit,
  aiConnectionProbeRateLimit,
  backupRateLimit,
  backupRestoreRateLimit,
  dataExportRateLimit,
} from '@middlewares/rate-limit';
import { Router } from 'express';

const router = Router({});

router.get('/', authenticateSession, getUser);
router.post('/feature-trials/:feature', authenticateSession, startFeatureTrial);
router.put('/update', authenticateSession, updateUser);
router.delete('/delete', authenticateSession, checkBaseCurrencyLock, deleteUser);
router.post('/wipe-data', authenticateSession, checkBaseCurrencyLock, wipeUserData);
router.post(
  '/data-export',
  authenticateSession,
  requireFeature(FEATURES.data_export),
  dataExportRateLimit,
  exportDataController,
);
router.post(
  '/backup',
  authenticateSession,
  requireFeature(FEATURES.backup_export),
  backupRateLimit,
  exportBackupController,
);
router.post(
  '/backup/restore',
  authenticateSession,
  requireFeature(FEATURES.backup_restore),
  // Guard the most destructive write like every other mutating route: 423 while a
  // base-currency migration (or an in-flight restore, which takes the same lock) runs.
  checkBaseCurrencyLock,
  backupRestoreRateLimit,
  restoreBackupController,
);
router.get('/backup/restore/status', authenticateSession, activeRestoreStatusController);
router.get('/backup/restore/status/:jobId', authenticateSession, restoreStatusController);

router.get('/currencies', authenticateSession, getUserCurrencies);
router.get('/currencies/base', authenticateSession, getUserBaseCurrency);
router.get('/currencies/rates', authenticateSession, getCurrenciesExchangeRates);

router.post('/currencies', authenticateSession, checkBaseCurrencyLock, addUserCurrencies);
router.post('/currencies/base', authenticateSession, checkBaseCurrencyLock, setBaseUserCurrency);
// The enqueue route owns its own dedupe: its NX lock acquisition returns the proper 423,
// so guarding it here would reject the request that is supposed to start the change.
router.post('/currencies/change-base', authenticateSession, changeBaseCurrency);
// Read-only status any device polls to drive the blocking overlay; GET routes are
// never lock-guarded.
router.get('/currencies/change-base/status', authenticateSession, changeBaseCurrencyStatus);

router.put('/currency', authenticateSession, checkBaseCurrencyLock, editUserCurrency);
router.put('/currency/rates', authenticateSession, checkBaseCurrencyLock, editCurrencyExchangeRate);

router.delete('/currency', authenticateSession, checkBaseCurrencyLock, deleteUserCurrency);
router.delete('/currency/rates', authenticateSession, checkBaseCurrencyLock, removeUserCurrencyExchangeRate);

router.get('/settings', authenticateSession, getUserSettings);
router.put('/settings', authenticateSession, updateUserSettings);
router.patch('/settings', authenticateSession, requireFireSettingsAccess, patchUserSettings);

// Onboarding (Quick Start)
router.get('/settings/onboarding', authenticateSession, getOnboarding);
router.put('/settings/onboarding', authenticateSession, updateOnboarding);

// AI connections (the user's own models)
router.get('/settings/ai/connections', authenticateSession, getConnectionsController);
router.post('/settings/ai/connections', authenticateSession, aiConnectionProbeRateLimit, createConnectionController);
router.post('/settings/ai/connections/test', authenticateSession, aiConnectionProbeRateLimit, testConnectionController);
router.post(
  '/settings/ai/connections/models',
  authenticateSession,
  aiConnectionModelsRateLimit,
  listConnectionModelsController,
);
router.put('/settings/ai/connections/:id', authenticateSession, aiConnectionProbeRateLimit, updateConnectionController);
router.delete('/settings/ai/connections/:id', authenticateSession, deleteConnectionController);
router.post('/settings/ai/connections/:id/default', authenticateSession, setDefaultConnectionController);

// AI Feature configuration
router.get('/settings/ai/features', authenticateSession, getFeaturesStatus);
router.get('/settings/ai/features/:feature', authenticateSession, getFeatureConfigController);
router.put('/settings/ai/features/:feature', authenticateSession, setFeatureConfigController);
router.delete('/settings/ai/features/:feature', authenticateSession, resetFeatureConfigController);

// AI Custom Instructions
router.get('/settings/ai/custom-instructions', authenticateSession, getCustomInstructionsController);
router.put('/settings/ai/custom-instructions', authenticateSession, setCustomInstructionsController);

// AI Categorization
router.get('/ai/categorization/status', authenticateSession, categorizationStatusController);
router.get('/ai/categorization/candidates', authenticateSession, categorizationCandidatesController);
router.get('/ai/categorization/history', authenticateSession, categorizationHistoryController);
router.post(
  '/ai/categorization/trigger',
  authenticateSession,
  // Demo users would fall back to the operator's server-side AI key.
  blockDemoUsers,
  triggerCategorizationController,
);

// MCP Connected Apps
router.get('/settings/mcp/connected-apps', authenticateSession, getConnectedAppsController);
router.delete('/settings/mcp/connected-apps/:clientId', authenticateSession, revokeConnectedAppController);

export default router;
