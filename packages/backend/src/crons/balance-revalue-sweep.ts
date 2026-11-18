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

interface Candidate {
  accountId: string;
  type: ACCOUNT_TYPES;
  isForeign: boolean;
  hasSeam: boolean;
}

const loadCandidateAccounts = async (): Promise<Candidate[]> =>
  (await connection.sequelize.query(
    `SELECT a."id" AS "accountId", a."type" AS "type",
            a."currencyCode" <> uc."currencyCode" AS "isForeign",
            a."seamBalance" IS NOT NULL AS "hasSeam"
       FROM "Accounts" a
       JOIN "UsersCurrencies" uc ON uc."userId" = a."userId" AND uc."isDefaultCurrency" = true
      WHERE a."accountCategory" NOT IN (:dedicatedFlowCategories)
        AND (a."currencyCode" <> uc."currencyCode" OR (a."seamBalance" IS NOT NULL AND a."type" <> :system))
      ORDER BY a."id"`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        dedicatedFlowCategories: [...DEDICATED_FLOW_ACCOUNT_CATEGORIES],
        system: ACCOUNT_TYPES.system,
      },
    },
  )) as Candidate[];

/**
 * Sequential on purpose: rebuilding every foreign-currency account at once floods the DB.
 *
 * Bank-synced foreign-currency accounts get today's row re-valued from their last-known
 * native balance. The provider owns their history, so only the days before a bank seam
 * are rebuilt from transactions.
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
    const { accountId } = candidate;
    const isBankAccount = candidate.type !== ACCOUNT_TYPES.system;
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<void>) => {
      try {
        await step();
      } catch (error) {
        failures.push(error);
        logger.error(
          { message: `Balance revalue sweep failed for account ${accountId}`, error: error as Error },
          { code: 'BALANCE_REVALUE_SWEEP_ACCOUNT_FAILED', accountId },
        );
      }
    };

    if (isBankAccount && candidate.isForeign) {
      await attempt(async () => {
        const account = await Accounts.findByPk(accountId);
        if (!account) throw new Error(`Account ${accountId} disappeared mid-sweep`);
        await writeBankBalanceWithHistory({ account, balance: account.currentBalance });
      });
    }

    if (!isBankAccount || candidate.hasSeam) {
      await attempt(async () => {
        if ((await revalueBalanceHistory({ accountId })) === 'skipped') {
          failures.push(`Account ${accountId} skipped: balance history not rebuilt`);
          logger.warn('Balance revalue sweep skipped account: balance history not rebuilt', { accountId });
        }
      });
    }

    if (failures.length === 0) {
      result.successfulUpdates += 1;
    } else {
      result.failedUpdates += 1;
      result.errors.push(...failures);
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
