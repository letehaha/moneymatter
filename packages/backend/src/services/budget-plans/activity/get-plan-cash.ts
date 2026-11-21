import { type MinorUnits, RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import BudgetPlans from '@models/budget-plans.model';
import { connection } from '@models/connection';
import { getBaseCurrency } from '@models/users-currencies.model';
import { buildRateForDay } from '@services/balances/revalue-balance-history.service';
import { toDayKey } from '@services/exchange-rates/build-daily-pair-rate-resolver';
import { getCreditLimitMinorByAccount } from '@services/stats/get-credit-limit-adjustment';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { QueryTypes } from 'sequelize';

import { localMidnight, utcInstant } from '../date-ranges';

/** Money columns and SUMs arrive from the raw query as DECIMAL strings in major units. */
interface CashRow {
  accountId: RecordId;
  currencyCode: string;
  nativeLimit: string;
  nativeOpening: string;
  opening: string;
  closing: string;
}

const decimalToMinor = ({ value, decimals }: { value: string; decimals: number }): number =>
  Money.fromDecimal(value).toMinorUnits({ decimals });

/**
 * Base-currency minor units at `decimals` (converted from the DECIMAL columns at the query boundary) held in the plan's accounts just before the `opening` and
 * `closing` days start ('yyyy-MM-dd', in `timezone`): the current balance minus every
 * transaction from then on, a card net of its credit limit when the user's
 * include-credit-limits setting is on. A foreign account's
 * opening is valued at the opening day's rate, so a later rate move shows as drift.
 *
 * ponytail: every attached account counts as attached since the epoch; an
 * `attachedAt` column is the upgrade once attaching mid-plan must add inflow.
 */
export const getPlanCash = async ({
  plan,
  opening,
  closing,
  decimals,
  timezone,
}: {
  plan: BudgetPlans;
  opening: string;
  closing: string;
  /** The plan currency's decimals, which is the base currency's. */
  decimals: number;
  timezone: string;
}): Promise<{ opening: number; closing: number }> => {
  const openingAt = localMidnight({ param: 'opening' });
  const closingAt = localMidnight({ param: 'closing' });
  const [limits, baseCurrency, rows] = await Promise.all([
    getUserSettings({ userId: plan.userId }).then((settings) =>
      settings.includeCreditLimitInStats
        ? getCreditLimitMinorByAccount({ userId: plan.userId, accountScope: 'owned', decimals })
        : new Map<RecordId, MinorUnits>(),
    ),
    getBaseCurrency({ userId: plan.userId }),
    connection.sequelize.query(
      `
      WITH signed AS (
        SELECT t."accountId", t."time",
               CASE WHEN t."transactionType" = 'income' THEN t."refAmount" ELSE -t."refAmount" END AS "ref",
               CASE WHEN t."transactionType" = 'income' THEN t."amount" ELSE -t."amount" END AS "native"
        FROM real_transactions t
        JOIN "BudgetPlanAccounts" pa ON pa."accountId" = t."accountId" AND pa."planId" = :planId
        WHERE t."time" >= LEAST(${openingAt}, ${closingAt})
      )
      SELECT a.id AS "accountId", a."currencyCode", a."creditLimit" AS "nativeLimit",
             a."currentBalance" - COALESCE(SUM(s."native") FILTER (WHERE s."time" >= ${openingAt}), 0) AS "nativeOpening",
             a."refCurrentBalance" - COALESCE(SUM(s."ref") FILTER (WHERE s."time" >= ${openingAt}), 0) AS "opening",
             a."refCurrentBalance" - COALESCE(SUM(s."ref") FILTER (WHERE s."time" >= ${closingAt}), 0) AS "closing"
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
          opening,
          closing,
          timezone,
        },
      },
    ) as Promise<CashRow[]>,
  ]);

  const openings = await Promise.all(
    rows.map(async (row) => {
      if (row.currencyCode === baseCurrency?.currencyCode)
        return decimalToMinor({ value: row.opening, decimals }) - (limits.get(row.accountId) ?? 0);

      // The rate Balances revalue uses for the day; it reads stored rates only, never a provider.
      const openingDate = utcInstant({ date: opening });
      const rateForDay = await buildRateForDay({
        account: { id: row.accountId, userId: plan.userId, currencyCode: row.currencyCode },
        baseCurrencyCode: baseCurrency!.currencyCode,
        from: openingDate,
        to: openingDate,
      });
      const rate = rateForDay?.(toDayKey(openingDate)) ?? null;
      if (rate === null) {
        logger.warn('[Budget plans] No stored rate for an opening balance, using the current-rate value', {
          planId: plan.id,
          accountId: row.accountId,
          currency: row.currencyCode,
        });
        return decimalToMinor({ value: row.opening, decimals }) - (limits.get(row.accountId) ?? 0);
      }

      // The native figure stays a decimal through the rate and is rounded once, to the base minor unit:
      // rounding it to the base scale first would lose value (USD 0.60 at 100 JPY/USD is 60 JPY, not 100).
      const nativeLimit = limits.has(row.accountId) ? Money.fromDecimal(row.nativeLimit) : Money.zero();
      return Money.fromDecimal(row.nativeOpening)
        .subtract(nativeLimit)
        .multiply(rate)
        .roundHalfEven(decimals)
        .toMinorUnits({ decimals });
    }),
  );

  return {
    opening: openings.reduce((sum, minor) => sum + minor, 0),
    closing: rows.reduce(
      (sum, row) => sum + decimalToMinor({ value: row.closing, decimals }) - (limits.get(row.accountId) ?? 0),
      0,
    ),
  };
};
