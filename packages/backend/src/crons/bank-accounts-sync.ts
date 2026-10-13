import { DEFAULT_BANK_SYNC_HOURS_UTC, FEATURES } from '@bt/shared/types';
import { logger } from '@js/utils';
import { connection } from '@models/connection';
import type Users from '@models/users.model';
import { syncAllUserAccounts } from '@services/bank-data-providers/sync/sync-manager';
import { updateLastAutoSync } from '@services/bank-data-providers/sync/sync-status-tracker';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { resolveEntitlements } from '@services/entitlements/resolve-entitlements.service';
import { QueryTypes } from 'sequelize';

import { createScheduledSync } from './lib/create-scheduled-sync';

const ACTIVE_WITHIN_DAYS = 7;

type DueUser = Pick<Users, 'id' | 'role' | 'plan' | 'trialEndsAt' | 'firstBudgetPlanAt'>;

const loadDueUsers = async ({ now }: { now: Date }): Promise<DueUser[]> =>
  (await connection.sequelize.query(
    `SELECT DISTINCT u."id", u."role", u."plan", u."trialEndsAt", u."firstBudgetPlanAt"
       FROM "Users" u
       JOIN "BankDataProviderConnections" c ON c."userId" = u."id" AND c."isActive" = true
       JOIN ba_session s ON s."userId" = u."authUserId" AND s."updatedAt" >= :activeSince
       LEFT JOIN "UserSettings" us ON us."userId" = u."id"
      WHERE COALESCE(us."settings"->'bankSyncHoursUtc', :defaultHours::jsonb) @> to_jsonb(:hour::int)
      ORDER BY u."id"`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        hour: now.getUTCHours(),
        defaultHours: JSON.stringify(DEFAULT_BANK_SYNC_HOURS_UTC),
        activeSince: new Date(now.getTime() - ACTIVE_WITHIN_DAYS * 24 * 60 * 60 * 1000),
      },
    },
  )) as DueUser[];

/**
 * Queues a sync for every user whose schedule includes the current UTC hour.
 *
 * At most two slots per user, and a batch-capable provider spends one request per
 * connection per sync, so SimpleFIN's ~24 requests/day budget is never approached.
 */
export const runBankAccountsSync = async ({ now = new Date() }: { now?: Date } = {}) => {
  const users = await loadDueUsers({ now });
  let usersSynced = 0;
  let usersSkipped = 0;
  let usersFailed = 0;

  for (const user of users) {
    try {
      const { features } = await resolveEntitlements({ user });
      if (!features.includes(FEATURES.bank_providers) || (await isBaseCurrencyChangeLocked({ userId: user.id }))) {
        usersSkipped++;
        continue;
      }

      await syncAllUserAccounts(user.id);
      await updateLastAutoSync(user.id);
      usersSynced++;
    } catch (error) {
      usersFailed++;
      logger.error({ message: `[Bank Accounts Sync] Failed for user ${user.id}`, error: error as Error });
    }
  }

  // Every user failing points at an outage (Redis, queue), which must not log as a completed run.
  if (usersFailed > 0 && usersFailed === users.length) {
    throw new Error(`Bank accounts sync failed for all ${usersFailed} due users`);
  }

  return { usersDue: users.length, usersSynced, usersSkipped, usersFailed };
};

export const bankAccountsSyncCron = createScheduledSync({
  name: 'bank accounts sync',
  cronExpression: '0 * * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs hourly, syncing users scheduled for that hour',
  errorCode: 'BANK_ACCOUNTS_SYNC_CRON',
  run: () => runBankAccountsSync(),
});
