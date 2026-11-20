import { logger } from '@js/utils/logger';

import { AkahuProvider } from './akahu';
import { EnableBankingProvider } from './enablebanking';
import { LunchFlowProvider } from './lunchflow/lunchflow.provider';
import { MonobankProvider } from './monobank';
import { ensureMonobankQueueRecovery } from './monobank/transaction-sync-queue';
import { bankProviderRegistry } from './registry';
import { SimplefinProvider } from './simplefin/simplefin.provider';
import { WalutomatProvider } from './walutomat';

/**
 * Initialize and register all bank data providers
 * Should be called at application startup
 */
export function initializeBankProviders(): void {
  try {
    // Register Monobank provider
    bankProviderRegistry.register(new MonobankProvider());

    // Register Enable Banking provider
    bankProviderRegistry.register(new EnableBankingProvider());

    // Register LunchFlow provider
    bankProviderRegistry.register(new LunchFlowProvider());

    // Register Walutomat provider
    bankProviderRegistry.register(new WalutomatProvider());

    // Register SimpleFIN Bridge provider
    bankProviderRegistry.register(new SimplefinProvider());

    // Register Akahu (NZ open banking, personal apps) provider
    bankProviderRegistry.register(new AkahuProvider());

    const registeredTypes = bankProviderRegistry.listTypes();
    logger.info(
      `[Bank Data Providers] Successfully initialized ${registeredTypes.length} provider(s): ${registeredTypes.join(', ')}`,
    );

    // Monobank uses per-token BullMQ queues created lazily on enqueue.
    // After a restart we need to re-bind workers to queues that still hold
    // pending jobs in Redis, otherwise those jobs sit idle until that token
    // is synced again. Skip in tests — each Jest worker starts clean and
    // recovery would race with the test's own enqueue.
    if (process.env.NODE_ENV !== 'test') {
      ensureMonobankQueueRecovery().catch(() => {
        // Already logged inside the recovery routine; keep startup non-fatal.
      });
    }
  } catch (error) {
    logger.error({ message: '[Bank Data Providers] Failed to initialize providers:', error: error as Error });
    throw error;
  }
}
