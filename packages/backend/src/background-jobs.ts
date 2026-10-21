import { logger } from '@js/utils/logger';
import { shutdownPostHog } from '@js/utils/posthog';
import { accountSyncWorker } from '@services/bank-data-providers/sync/account-sync-queue';

import { aiUsageMonthEndCron } from './crons/ai-usage-month-end';
import { attachmentsOrphanSweepCron } from './crons/attachments-orphan-sweep';
import { balanceRevalueSweepCron } from './crons/balance-revalue-sweep';
import { bankAccountsSyncCron } from './crons/bank-accounts-sync';
import { budgetPlansPurgeCron } from './crons/budget-plans-purge';
import { cryptoPricesSyncCron } from './crons/crypto-prices-sync';
import { demoCleanupCron } from './crons/demo-cleanup';
import { demoTemplateRefreshCron } from './crons/demo-template-refresh';
import { loadCurrencyRatesJob } from './crons/exchange-rates';
import { goalsReachedCheckCron } from './crons/goals-reached-check';
import { purgeDeletedPortfoliosCron } from './crons/purge-deleted-portfolios';
import { securitiesDailySyncCron } from './crons/securities-daily-sync';
import { shareInvitationsExpireCron } from './crons/share-invitations-expire';
import { shareResourceOrphanCleanupCron } from './crons/share-resource-orphan-cleanup';
import { stuckPendingCheckCron } from './crons/stuck-pending-check';
import { subscriptionAutoRecordCron } from './crons/subscription-auto-record';
import { subscriptionCandidateDetectionCron } from './crons/subscription-candidate-detection';
import { subscriptionRemindersCron } from './crons/subscription-reminders-check';
import { tagRemindersCron } from './crons/tag-reminders-check';
import { trackerSmartScanCron } from './crons/tracker-smart-scan';
import { initializeHistoricalRates } from './services/exchange-rates/initialize-historical-rates.service';

const allEnvCrons = [demoCleanupCron, demoTemplateRefreshCron];

const prodOnlyCrons = [
  securitiesDailySyncCron,
  cryptoPricesSyncCron,
  tagRemindersCron,
  stuckPendingCheckCron,
  goalsReachedCheckCron,
  subscriptionRemindersCron,
  subscriptionAutoRecordCron,
  subscriptionCandidateDetectionCron,
  shareInvitationsExpireCron,
  shareResourceOrphanCleanupCron,
  purgeDeletedPortfoliosCron,
  budgetPlansPurgeCron,
  balanceRevalueSweepCron,
  attachmentsOrphanSweepCron,
  bankAccountsSyncCron,
  trackerSmartScanCron,
  aiUsageMonthEndCron,
];

export function initializeBackgroundJobs() {
  const isOfflineMode = process.env.OFFLINE_MODE === 'true';
  const isTestMode = process.env.NODE_ENV === 'test';

  if (isOfflineMode || isTestMode) {
    logger.info(`[${isTestMode ? 'Test' : 'Offline'} Mode] Skipping background jobs that require internet connection`);
    return;
  }

  // Initialize historical exchange rates on startup (non-blocking)
  initializeHistoricalRates();

  loadCurrencyRatesJob.start();

  for (const cron of allEnvCrons) cron.startCron();

  if (process.env.NODE_ENV === 'production') {
    for (const cron of prodOnlyCrons) cron.startCron();
  }
}

export async function shutdownBackgroundJobs() {
  for (const cron of [...allEnvCrons, ...prodOnlyCrons]) cron.stopCron();
  loadCurrencyRatesJob.stop();
  await accountSyncWorker.close();
  // Flush remaining PostHog events before exit
  await shutdownPostHog();
}
