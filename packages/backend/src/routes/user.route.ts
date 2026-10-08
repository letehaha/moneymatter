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

router.use(authenticateSession);

router.get('/', getUser);
router.post('/feature-trials/:feature', startFeatureTrial);
router.put('/update', updateUser);
router.delete('/delete', checkBaseCurrencyLock, deleteUser);
router.post('/wipe-data', checkBaseCurrencyLock, wipeUserData);
router.post('/data-export', requireFeature(FEATURES.data_export), dataExportRateLimit, exportDataController);
router.post('/backup', requireFeature(FEATURES.backup_export), backupRateLimit, exportBackupController);
router.post(
  '/backup/restore',
  requireFeature(FEATURES.backup_restore),
  // Guard the most destructive write like every other mutating route: 423 while a
  // base-currency migration (or an in-flight restore, which takes the same lock) runs.
  checkBaseCurrencyLock,
  backupRestoreRateLimit,
  restoreBackupController,
);
router.get('/backup/restore/status', activeRestoreStatusController);
router.get('/backup/restore/status/:jobId', restoreStatusController);

router.get('/currencies', getUserCurrencies);
router.get('/currencies/base', getUserBaseCurrency);
router.get('/currencies/rates', getCurrenciesExchangeRates);

router.post('/currencies', checkBaseCurrencyLock, addUserCurrencies);
router.post('/currencies/base', checkBaseCurrencyLock, setBaseUserCurrency);
// The enqueue route owns its own dedupe: its NX lock acquisition returns the proper 423,
// so guarding it here would reject the request that is supposed to start the change.
router.post('/currencies/change-base', changeBaseCurrency);
// Read-only status any device polls to drive the blocking overlay; GET routes are
// never lock-guarded.
router.get('/currencies/change-base/status', changeBaseCurrencyStatus);

router.put('/currency', checkBaseCurrencyLock, editUserCurrency);
router.put('/currency/rates', checkBaseCurrencyLock, editCurrencyExchangeRate);

router.delete('/currency', checkBaseCurrencyLock, deleteUserCurrency);
router.delete('/currency/rates', checkBaseCurrencyLock, removeUserCurrencyExchangeRate);

router.get('/settings', getUserSettings);
router.put('/settings', updateUserSettings);
router.patch('/settings', requireFireSettingsAccess, patchUserSettings);

// Onboarding (Quick Start)
router.get('/settings/onboarding', getOnboarding);
router.put('/settings/onboarding', updateOnboarding);

// AI connections (the user's own models)
router.get('/settings/ai/connections', getConnectionsController);
router.post('/settings/ai/connections', aiConnectionProbeRateLimit, createConnectionController);
router.post('/settings/ai/connections/test', aiConnectionProbeRateLimit, testConnectionController);
router.post('/settings/ai/connections/models', aiConnectionModelsRateLimit, listConnectionModelsController);
router.put('/settings/ai/connections/:id', aiConnectionProbeRateLimit, updateConnectionController);
router.delete('/settings/ai/connections/:id', deleteConnectionController);
router.post('/settings/ai/connections/:id/default', setDefaultConnectionController);

// AI Feature configuration
router.get('/settings/ai/features', getFeaturesStatus);
router.get('/settings/ai/features/:feature', getFeatureConfigController);
router.put('/settings/ai/features/:feature', setFeatureConfigController);
router.delete('/settings/ai/features/:feature', resetFeatureConfigController);

// AI Custom Instructions
router.get('/settings/ai/custom-instructions', getCustomInstructionsController);
router.put('/settings/ai/custom-instructions', setCustomInstructionsController);

// AI Categorization
router.get('/ai/categorization/status', categorizationStatusController);
router.get('/ai/categorization/candidates', categorizationCandidatesController);
router.get('/ai/categorization/history', categorizationHistoryController);
router.post(
  '/ai/categorization/trigger',
  // Demo users would fall back to the operator's server-side AI key.
  blockDemoUsers,
  triggerCategorizationController,
);

// MCP Connected Apps
router.get('/settings/mcp/connected-apps', getConnectedAppsController);
router.delete('/settings/mcp/connected-apps/:clientId', revokeConnectedAppController);

export default router;
