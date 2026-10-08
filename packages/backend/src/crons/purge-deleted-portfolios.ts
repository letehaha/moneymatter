import { purgeDeletedPortfolios } from '@services/investments/portfolios/purge-deleted.service';

import { createScheduledSync } from './lib/create-scheduled-sync';

/**
 * Daily sweep that finalises soft-deleted portfolios past the retention
 * window. The user-facing delete endpoint sets `deletedAt`; this job runs
 * `deletePortfolio({ force: true })` so child rows (holdings, investment
 * transactions, balances) are cascaded out.
 *
 * Schedule: 03:45 UTC daily, staggered after the share-related sweeps
 * (03:15 / 03:30) to avoid DB-connection contention.
 */
export const purgeDeletedPortfoliosCron = createScheduledSync({
  name: 'purge of soft-deleted portfolios',
  cronExpression: '45 3 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 03:45 UTC',
  errorCode: 'PURGE_DELETED_PORTFOLIOS_CRON',
  run: purgeDeletedPortfolios,
});
