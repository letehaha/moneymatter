import { logger } from '@js/utils/logger';
import { shutdownPostHog } from '@js/utils/posthog';
import { accountSyncWorker } from '@services/bank-data-providers/sync/account-sync-queue';

import { attachmentsOrphanSweepCron } from './crons/attachments-orphan-sweep';
import { balanceRevalueSweepCron } from './crons/balance-revalue-sweep';
import { cryptoPricesSyncCron } from './crons/crypto-prices-sync';
import { demoCleanupCron } from './crons/demo-cleanup';
import { demoTemplateRefreshCron } from './crons/demo-template-refresh';
import { loadCurrencyRatesJob } from './crons/exchange-rates';
import { purgeDeletedPortfoliosCron } from './crons/purge-deleted-portfolios';
import { securitiesDailySyncCron } from './crons/securities-daily-sync';
import { shareInvitationsExpireCron } from './crons/share-invitations-expire';
import { shareResourceOrphanCleanupCron } from './crons/share-resource-orphan-cleanup';
import { stuckPendingCheckCron } from './crons/stuck-pending-check';
import { subscriptionAutoRecordCron } from './crons/subscription-auto-record';
import { subscriptionCandidateDetectionCron } from './crons/subscription-candidate-detection';
import { subscriptionRemindersCron } from './crons/subscription-reminders-check';
import { tagRemindersCron } from './crons/tag-reminders-check';
import { initializeHistoricalRates } from './services/exchange-rates/initialize-historical-rates.service';

export function initializeBackgroundJobs() {
  const isOfflineMode = process.env.OFFLINE_MODE === 'true';
  const isTestMode = process.env.NODE_ENV === 'test';

  if (isOfflineMode || isTestMode) {
    logger.info(`[${isTestMode ? 'Test' : 'Offline'} Mode] Skipping background jobs that require internet connection`);
  } else {
    // Initialize historical exchange rates on startup (non-blocking)
    initializeHistoricalRates();

    loadCurrencyRatesJob.start();

    // Demo cleanup and template refresh run in all environments (dev and prod)
    demoCleanupCron.startCron();
    demoTemplateRefreshCron.startCron();

    if (process.env.NODE_ENV === 'production') {
      securitiesDailySyncCron.startCron();
      cryptoPricesSyncCron.startCron();
      tagRemindersCron.startCron();
      stuckPendingCheckCron.startCron();
      subscriptionRemindersCron.startCron();
      subscriptionAutoRecordCron.startCron();
      subscriptionCandidateDetectionCron.startCron();
      shareInvitationsExpireCron.startCron();
      shareResourceOrphanCleanupCron.startCron();
      purgeDeletedPortfoliosCron.startCron();
      balanceRevalueSweepCron.startCron();
      attachmentsOrphanSweepCron.startCron();
    }
  }
}

export async function shutdownBackgroundJobs() {
  demoCleanupCron.stopCron();
  demoTemplateRefreshCron.stopCron();
  securitiesDailySyncCron.stopCron();
  cryptoPricesSyncCron.stopCron();
  tagRemindersCron.stopCron();
  stuckPendingCheckCron.stopCron();
  subscriptionRemindersCron.stopCron();
  subscriptionAutoRecordCron.stopCron();
  subscriptionCandidateDetectionCron.stopCron();
  shareInvitationsExpireCron.stopCron();
  shareResourceOrphanCleanupCron.stopCron();
  purgeDeletedPortfoliosCron.stopCron();
  balanceRevalueSweepCron.stopCron();
  attachmentsOrphanSweepCron.stopCron();
  loadCurrencyRatesJob.stop();
  await accountSyncWorker.close();
  // Flush remaining PostHog events before exit
  await shutdownPostHog();
}
