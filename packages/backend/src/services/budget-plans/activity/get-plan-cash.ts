import { RecordId } from '@bt/shared/types';
import { roundHalfToEven } from '@common/utils/round-half-to-even';
import { logger } from '@js/utils/logger';
import BudgetPlans from '@models/budget-plans.model';
import { connection } from '@models/connection';
import UsersCurrencies, { getBaseCurrency } from '@models/users-currencies.model';
import { buildDailyPairRateResolver, toDayKey } from '@services/exchange-rates/build-daily-pair-rate-resolver';
import { getCreditLimitCentsByAccount } from '@services/stats/get-credit-limit-adjustment';
import { resolveCustomRate } from '@services/user-exchange-rate/get-exchange-rate.service';
import { QueryTypes } from 'sequelize';

import { utcInstant } from '../date-ranges';

interface CashRow {
  accountId: RecordId;
  currencyCode: string;
  nativeLimit: string | number;
  nativeOpening: string | number;
  opening: string | number;
  closing: string | number;
}

/**
 * The rate Balances revalue uses for a day: the user's manual rate, else the
 * latest stored market rate on or before it. Reads only, never fetches a provider.
 */
const storedRate = async ({
  userId,
  baseCode,
  quoteCode,
  date,
}: {
  userId: number;
  baseCode: string;
  quoteCode: string;
  date: Date;
}): Promise<number | null> => {
  const userCurrency = (await UsersCurrencies.findOne({
    where: { userId, currencyCode: baseCode },
    attributes: ['liveRateUpdate'],
    raw: true,
  })) as { liveRateUpdate: boolean | null } | null;
  const custom = await resolveCustomRate({
    userId,
    pair: { baseCode, quoteCode },
    liveRateUpdate: userCurrency?.liveRateUpdate ?? null,
  });
  if (custom) return custom.rate;

  const resolve = await buildDailyPairRateResolver({ baseCode, quoteCode, from: date, to: date });
  return resolve?.(toDayKey(date)) ?? null;
};

/**
 * Base-currency cents held in the plan's accounts just before the `opening` and
 * `closing` days start ('yyyy-MM-dd', UTC): the current balance minus every
 * transaction from then on, a card net of its credit limit. A foreign account's
 * opening is valued at the opening day's rate, so a later rate move shows as drift.
 *
 * ponytail: every attached account counts as attached since the epoch; an
 * `attachedAt` column is the upgrade once attaching mid-plan must add inflow.
 */
export const getPlanCash = async ({
  plan,
  opening,
  closing,
}: {
  plan: BudgetPlans;
  opening: string;
  closing: string;
}): Promise<{ opening: number; closing: number }> => {
  const openingUtc = utcInstant({ date: opening });
  const [limits, baseCurrency, rows] = await Promise.all([
    getCreditLimitCentsByAccount({ userId: plan.userId, accountScope: 'owned' }),
    getBaseCurrency({ userId: plan.userId }),
    connection.sequelize.query(
      `
      WITH signed AS (
        SELECT t."accountId", t."time",
               CASE WHEN t."transactionType" = 'income' THEN t."refAmount" ELSE -t."refAmount" END AS "cents",
               CASE WHEN t."transactionType" = 'income' THEN t."amount" ELSE -t."amount" END AS "native"
        FROM real_transactions t
        JOIN "BudgetPlanAccounts" pa ON pa."accountId" = t."accountId" AND pa."planId" = :planId
        WHERE t."time" >= LEAST(CAST(:openingUtc AS timestamptz), CAST(:closingUtc AS timestamptz))
      )
      SELECT a.id AS "accountId", a."currencyCode", a."creditLimit" AS "nativeLimit",
             a."currentBalance" - COALESCE(SUM(s."native") FILTER (WHERE s."time" >= :openingUtc), 0) AS "nativeOpening",
             a."refCurrentBalance" - COALESCE(SUM(s."cents") FILTER (WHERE s."time" >= :openingUtc), 0) AS "opening",
             a."refCurrentBalance" - COALESCE(SUM(s."cents") FILTER (WHERE s."time" >= :closingUtc), 0) AS "closing"
      FROM "BudgetPlanAccounts" pa
      JOIN "Accounts" a ON a.id = pa."accountId" AND a."excludeFromStats" = false AND a."userId" = :ownerId
      LEFT JOIN signed s ON s."accountId" = a.id
      WHERE pa."planId" = :planId
      GROUP BY a.id
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          planId: plan.id,
          ownerId: plan.userId,
          openingUtc,
          closingUtc: utcInstant({ date: closing }),
        },
      },
    ) as Promise<CashRow[]>,
  ]);

  const openings = await Promise.all(
    rows.map(async (row) => {
      if (row.currencyCode === baseCurrency?.currencyCode)
        return Number(row.opening) - (limits.get(row.accountId) ?? 0);

      const rate = await storedRate({
        userId: plan.userId,
        baseCode: row.currencyCode,
        quoteCode: baseCurrency!.currencyCode,
        date: openingUtc,
      });
      if (rate === null) {
        logger.warn('[Budget plans] No stored rate for an opening balance, using the current-rate value', {
          planId: plan.id,
          accountId: row.accountId,
          currency: row.currencyCode,
        });
        return Number(row.opening) - (limits.get(row.accountId) ?? 0);
      }

      const nativeLimit = limits.has(row.accountId) ? Number(row.nativeLimit) : 0;
      return roundHalfToEven((Number(row.nativeOpening) - nativeLimit) * rate);
    }),
  );

  return {
    opening: openings.reduce((sum, cents) => sum + cents, 0),
    closing: rows.reduce((sum, row) => sum + Number(row.closing) - (limits.get(row.accountId) ?? 0), 0),
  };
};
