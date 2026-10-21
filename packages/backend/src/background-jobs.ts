import { logger } from '@js/utils/logger';
import { shutdownPostHog } from '@js/utils/posthog';
import { accountSyncWorker } from '@services/bank-data-providers/sync/account-sync-queue';

import { aiUsageMonthEndCron } from './crons/ai-usage-month-end';
import { attachmentsOrphanSweepCron } from './crons/attachments-orphan-sweep';
import { balanceRevalueSweepCron } from './crons/balance-revalue-sweep';
import { bankAccountsSyncCron } from './crons/bank-accounts-sync';
import { budgetPlansPurgeCron } from './crons/budget-plans-purge';
import { chatRetentionCron } from './crons/chat-retention';
import { chatRunSweepCron } from './crons/chat-run-sweep';
import { coingeckoRatesSyncCron } from './crons/coingecko-rates-sync';
import { cryptoPricesSyncCron } from './crons/crypto-prices-sync';
import { demoCleanupCron } from './crons/demo-cleanup';
import { demoTemplateRefreshCron } from './crons/demo-template-refresh';
import { loadCurrencyRatesJob } from './crons/exchange-rates';
import { httpRatesSyncCron } from './crons/http-rates-sync';
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
import { shutdownChatRuns } from './services/chat/runs/run-manager';
import { chatTailHub } from './services/chat/runs/tail-hub';
import { initializeHistoricalRates } from './services/exchange-rates/initialize-historical-rates.service';

const allEnvCrons = [demoCleanupCron, demoTemplateRefreshCron];

const prodOnlyCrons = [
  securitiesDailySyncCron,
  cryptoPricesSyncCron,
  coingeckoRatesSyncCron,
  httpRatesSyncCron,
  tagRemindersCron,
  stuckPendingCheckCron,
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

  // Chat runs need no internet (a local model is a normal setup), so recovering the ones a restart
  // cut short does not wait for the online-only jobs. The first sweep runs now, the cron repeats it.
  // The same goes for the retention sweep: an offline install must still delete expired history.
  if (!isTestMode) {
    chatRunSweepCron.startCron();
    chatRunSweepCron.triggerManualSync().catch(() => undefined);
    chatRetentionCron.startCron();
  }

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
  for (const cron of [...allEnvCrons, ...prodOnlyCrons, chatRunSweepCron, chatRetentionCron]) cron.stopCron();
  loadCurrencyRatesJob.stop();
  // Interrupts the chat runs of this process (their messages end as interrupted), then closes the
  // Redis connection their streams are tailed on.
  await shutdownChatRuns();
  await chatTailHub.close();
  await accountSyncWorker.close();
  // Flush remaining PostHog events before exit
  await shutdownPostHog();
}
