import { ACCOUNT_TYPES, DEDICATED_FLOW_ACCOUNT_CATEGORIES } from '@bt/shared/types';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import { connection } from '@models/connection';
import { revalueBalanceHistory } from '@services/balances/revalue-balance-history.service';
import { writeBankBalanceWithHistory } from '@services/bank-data-providers/utils/write-bank-balance-with-history';
import { withLock } from '@services/common/lock';
import { QueryTypes } from 'sequelize';

import { createScheduledSync } from './lib/create-scheduled-sync';

interface SyncResult {
  totalProcessed: number;
  successfulUpdates: number;
  failedUpdates: number;
  errors: unknown[];
}

const loadCandidateAccounts = async (): Promise<{ accountId: string; type: ACCOUNT_TYPES }[]> =>
  (await connection.sequelize.query(
    `SELECT a."id" AS "accountId", a."type" AS "type"
       FROM "Accounts" a
       JOIN "UsersCurrencies" uc ON uc."userId" = a."userId" AND uc."isDefaultCurrency" = true
      WHERE a."accountCategory" NOT IN (:dedicatedFlowCategories)
        AND a."currencyCode" <> uc."currencyCode"
      ORDER BY a."id"`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        dedicatedFlowCategories: [...DEDICATED_FLOW_ACCOUNT_CATEGORIES],
      },
    },
  )) as { accountId: string; type: ACCOUNT_TYPES }[];

/**
 * Sequential on purpose: rebuilding every foreign-currency account at once floods the DB.
 *
 * Bank-synced accounts only get today's row re-valued from their last-known native
 * balance — the provider owns their history, so it is never rebuilt from transactions.
 */
export const runBalanceRevalueSweep = async (): Promise<SyncResult> => {
  const candidates = await loadCandidateAccounts();
  const result: SyncResult = {
    totalProcessed: candidates.length,
    successfulUpdates: 0,
    failedUpdates: 0,
    errors: [],
  };

  for (const candidate of candidates) {
    try {
      if (candidate.type !== ACCOUNT_TYPES.system) {
        const account = await Accounts.findByPk(candidate.accountId);

        if (!account) {
          throw new Error(`Account ${candidate.accountId} disappeared mid-sweep`);
        }

        await writeBankBalanceWithHistory({ account, balance: account.currentBalance });
        result.successfulUpdates += 1;
        continue;
      }

      const outcome = await revalueBalanceHistory({ accountId: candidate.accountId });

      if (outcome === 'skipped') {
        result.failedUpdates += 1;
        result.errors.push(`Account ${candidate.accountId} skipped: no exchange rate coverage`);
      } else {
        result.successfulUpdates += 1;
      }
    } catch (error) {
      result.failedUpdates += 1;
      result.errors.push(error);
      logger.error(
        {
          message: `Balance revalue sweep failed for account ${candidate.accountId}`,
          error: error as Error,
        },
        { code: 'BALANCE_REVALUE_SWEEP_ACCOUNT_FAILED' },
      );
    }
  }

  return result;
};

/**
 * Nightly safety net: writes today's row at today's rate so foreign-currency charts
 * move on days without transactions, and heals accounts a write path left stale.
 *
 * Must run after `loadCurrencyRatesJob` (18:00 UTC) has stored today's rates, or
 * today's row gets valued at yesterday's rate.
 */
export const balanceRevalueSweepCron = createScheduledSync({
  name: 'balance revalue sweep',
  cronExpression: '45 18 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 18:45 UTC',
  // A sweep over every foreign-currency account can outlive the default 30-minute
  // lock TTL, which would let a second instance start on top of a running one.
  run: withLock('lock:cron:balance-revalue-sweep', runBalanceRevalueSweep, { ttl: 60 * 60 * 4 }),
});
