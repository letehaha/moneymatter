import { ACCOUNT_TYPES, isDedicatedFlowAccountCategory, TRANSACTION_TYPES } from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { toMoneyColumnValue } from '@common/types/money-column';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import { connection } from '@models/connection';
import UsersCurrencies, { getBaseCurrency } from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import {
  buildDailyPairRateResolver,
  type DailyPairRateResolver,
  MS_PER_DAY,
  toDayKey,
} from '@services/exchange-rates/build-daily-pair-rate-resolver';
import { resolveCustomRate } from '@services/user-exchange-rate/get-exchange-rate.service';
import { AsyncLocalStorage } from 'node:async_hooks';
import { QueryTypes } from 'sequelize';
import { v7 as uuidv7 } from 'uuid';

const dayKeyToDate = (dayKey: string): Date => new Date(`${dayKey}T00:00:00.000Z`);

/** Every day in this file is a UTC bucket: the SQL truncates in UTC, the day walk
 *  steps UTC midnights, and `Balances.date` is a `YYYY-MM-DD` string. */
const utcDayStart = (date: Date): Date => dayKeyToDate(toDayKey(date));

/** The same guard `revalueBalanceHistory` applies internally, exported so a caller can
 *  pick the incremental path before a revalue would no-op. */
export const isRevaluedAccount = ({
  account,
  baseCurrencyCode,
}: {
  account: Pick<Accounts, 'type' | 'accountCategory' | 'currencyCode'>;
  baseCurrencyCode: string;
}): boolean =>
  account.type === ACCOUNT_TYPES.system &&
  !isDedicatedFlowAccountCategory(account.accountCategory) &&
  account.currencyCode !== baseCurrencyCode;

const signedAmountSql = `SUM(CASE WHEN "transactionType" = '${TRANSACTION_TYPES.income}' THEN "amount" ELSE -"amount" END)`;

const loadTransactionBounds = async ({
  accountId,
}: {
  accountId: string;
}): Promise<{ earliest: Date | null; latest: Date | null }> => {
  const [row] = (await connection.sequelize.query(
    `SELECT MIN("time") AS "earliest", MAX("time") AS "latest" FROM real_transactions WHERE "accountId" = :accountId`,
    { type: QueryTypes.SELECT, replacements: { accountId } },
  )) as { earliest: Date | null; latest: Date | null }[];

  return {
    earliest: row?.earliest ? new Date(row.earliest) : null,
    latest: row?.latest ? new Date(row.latest) : null,
  };
};

const loadOldestStoredDay = async ({ accountId }: { accountId: string }): Promise<string | null> => {
  const [row] = (await connection.sequelize.query(
    `SELECT to_char(MIN("date"), 'YYYY-MM-DD') AS "day" FROM "Balances" WHERE "accountId" = :accountId`,
    { type: QueryTypes.SELECT, replacements: { accountId } },
  )) as { day: string | null }[];

  return row?.day ?? null;
};

const loadDailyNativeDeltas = async ({
  accountId,
  from,
  toExclusive,
}: {
  accountId: string;
  from: Date;
  toExclusive: Date;
}): Promise<Map<string, Money>> => {
  const rows = (await connection.sequelize.query(
    `SELECT to_char(date_trunc('day', "time" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "day",
            ${signedAmountSql} AS "signedSum"
       FROM real_transactions
      WHERE "accountId" = :accountId AND "time" >= :from AND "time" < :toExclusive
      GROUP BY 1`,
    { type: QueryTypes.SELECT, replacements: { accountId, from, toExclusive } },
  )) as { day: string; signedSum: string }[];

  return new Map(rows.map((row) => [row.day, Money.fromDecimal(row.signedSum)]));
};

/** Delete before insert: a day the rebuild no longer emits must not survive and be
 *  read as a real measurement by the chart's forward fill. `ON CONFLICT` still guards
 *  the insert, because the 18:00 remeasure can pin today's row between the two. */
const writeBalanceRows = async ({
  accountId,
  fromDay,
  rows,
}: {
  accountId: string;
  fromDay: string;
  rows: { date: string; amount: Money }[];
}): Promise<void> => {
  if (!rows.length) return;

  await connection.sequelize.query(`DELETE FROM "Balances" WHERE "accountId" = :accountId AND "date" >= :fromDay`, {
    replacements: { accountId, fromDay },
  });

  const replacements: Record<string, unknown> = { accountId };
  const values = rows.map((row, index) => {
    replacements[`id${index}`] = uuidv7();
    replacements[`date${index}`] = row.date;
    replacements[`amount${index}`] = toMoneyColumnValue({ money: row.amount });
    return `(:id${index}, :accountId, :date${index}, :amount${index}, NOW(), NOW())`;
  });

  await connection.sequelize.query(
    `INSERT INTO "Balances" ("id", "accountId", "date", "amount", "createdAt", "updatedAt")
     VALUES ${values.join(', ')}
     ON CONFLICT ("accountId", "date") DO UPDATE
     SET "amount" = EXCLUDED."amount", "updatedAt" = NOW()`,
    { replacements },
  );
};

/**
 * Rewrite an account's daily `Balances` rows as "native units held that day × that
 * day's rate to the owner's base currency", from the day before its first transaction
 * (or its oldest stored row) through today (or its last transaction).
 *
 * The output is sparse: a row only where the value moves, plus the first day and
 * today. Every other row in the range is deleted, so the chart's forward fill reads
 * exactly what the rebuild computed.
 */
const revalueBalanceHistoryImpl = async ({ accountId }: { accountId: string }): Promise<'rebuilt' | 'skipped'> => {
  const account = await Accounts.findByPk(accountId);
  if (!account) return 'skipped';

  const baseCurrency = await getBaseCurrency({ userId: account.userId });
  if (!baseCurrency || !isRevaluedAccount({ account, baseCurrencyCode: baseCurrency.currencyCode })) return 'skipped';

  // Two rebuilds of the same account would otherwise interleave their writes and
  // leave the grid mixing rows from different runs.
  await connection.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext(:accountId))`, {
    type: QueryTypes.SELECT,
    replacements: { accountId },
  });

  const today = utcDayStart(new Date());
  const { earliest, latest } = await loadTransactionBounds({ accountId });
  const oldestStoredDay = await loadOldestStoredDay({ accountId });

  // The day before the first transaction carries the account's opening balance, so
  // the chart starts from the account's own money rather than from zero.
  const gridStart = new Date(
    Math.min(
      +today,
      earliest ? +utcDayStart(earliest) - MS_PER_DAY : Infinity,
      oldestStoredDay ? +dayKeyToDate(oldestStoredDay) : Infinity,
    ),
  );
  const gridEnd = new Date(Math.max(+today, latest ? +utcDayStart(latest) : +today));

  const userCurrency = (await UsersCurrencies.findOne({
    where: { userId: account.userId, currencyCode: account.currencyCode },
    attributes: ['liveRateUpdate'],
    raw: true,
  })) as { liveRateUpdate: boolean | null } | null;

  // A flat manual rate wins every day of the grid, so the market resolver is built
  // only when there is no manual rate. Only that resolver can abort the rebuild.
  const flatCustomRate =
    (
      await resolveCustomRate({
        userId: account.userId,
        pair: { baseCode: account.currencyCode, quoteCode: baseCurrency.currencyCode },
        liveRateUpdate: userCurrency?.liveRateUpdate ?? null,
      })
    )?.rate ?? null;

  let resolveRate: DailyPairRateResolver | null = null;
  if (flatCustomRate === null) {
    resolveRate = await buildDailyPairRateResolver({
      baseCode: account.currencyCode,
      quoteCode: baseCurrency.currencyCode,
      from: gridStart,
      to: gridEnd,
    });

    if (!resolveRate) {
      logger.warn('No stored exchange rate for pair; account left untouched', {
        accountId,
        pair: `${account.currencyCode}/${baseCurrency.currencyCode}`,
      });
      return 'skipped';
    }
  }

  const dailyDeltas = await loadDailyNativeDeltas({
    accountId,
    from: gridStart,
    toExclusive: new Date(+gridEnd + MS_PER_DAY),
  });

  const startKey = toDayKey(gridStart);
  const todayKey = toDayKey(today);

  const baseDecimals = await getCurrencyDecimals({ userId: account.userId, code: baseCurrency.currencyCode });

  let nativeBalance = account.initialBalance;
  let lastEmitted = null as Money | null;
  const rows: { date: string; amount: Money }[] = [];

  for (let time = +gridStart; time <= +gridEnd; time += MS_PER_DAY) {
    const dayKey = toDayKey(new Date(time));
    nativeBalance = nativeBalance.add(dailyDeltas.get(dayKey) ?? Money.zero());

    const rate = flatCustomRate ?? resolveRate?.(dayKey) ?? null;
    if (rate == null) {
      logger.warn('No exchange rate for day; account left untouched', {
        accountId,
        pair: `${account.currencyCode}/${baseCurrency.currencyCode}`,
        day: dayKey,
      });
      return 'skipped';
    }

    const amount = nativeBalance.multiply(rate).roundHalfEven(baseDecimals);
    // The chart forward-fills, so a day repeating the previous value carries no
    // information. Today always gets a row so the series tracks the daily rate.
    if (lastEmitted?.equals(amount) && dayKey !== startKey && dayKey !== todayKey) continue;

    lastEmitted = amount;
    rows.push({ date: dayKey, amount });
  }

  await writeBalanceRows({ accountId, fromDay: startKey, rows });

  return 'rebuilt';
};

export const revalueBalanceHistory = withTransaction(revalueBalanceHistoryImpl);

const revalueBatchStorage = new AsyncLocalStorage<Set<string>>();

/**
 * Collapse every revalue scheduled inside `fn` into one rebuild per account, run after
 * `fn` settles. Opened at entrypoints (HTTP controllers, cron and queue job bodies).
 *
 * Rebuilds run even when `fn` throws, since rows that did commit still need healing,
 * and the original error is rethrown. Nested scopes merge into the outermost one.
 */
export const runWithBalanceRevalueBatch = async <R>(fn: () => Promise<R>): Promise<R> => {
  if (revalueBatchStorage.getStore()) return fn();

  const queue = new Set<string>();
  try {
    return await revalueBatchStorage.run(queue, fn);
  } finally {
    for (const accountId of queue) {
      try {
        await revalueBalanceHistory({ accountId });
      } catch (error) {
        // The data is already committed; a failed rebuild leaves stale rows for
        // the nightly revalue job to correct rather than killing the process.
        logger.error(
          { message: 'Balance revalue failed after batch', error: error as Error },
          { code: 'BALANCE_REVALUE_BATCH_FAILED', accountId },
        );
      }
    }
  }
};

/**
 * Defer the rebuild to the end of the surrounding batch scope, or run it inline when
 * there is none. Inline under an ambient CLS transaction it joins that transaction, so
 * the rebuild commits together with the change that triggered it.
 */
export const scheduleBalanceRevalue = async ({ accountId }: { accountId: string }): Promise<void> => {
  const queue = revalueBatchStorage.getStore();
  if (queue) {
    queue.add(accountId);
    return;
  }

  await revalueBalanceHistory({ accountId });
};
