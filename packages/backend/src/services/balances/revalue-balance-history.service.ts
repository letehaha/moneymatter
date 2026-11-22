import { ACCOUNT_TYPES, isDedicatedFlowAccountCategory, TRANSACTION_TYPES } from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { toMoneyColumnValue } from '@common/types/money-column';
import { ExchangeRateUnavailableError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import { connection } from '@models/connection';
import UsersCurrencies, { getBaseCurrency } from '@models/users-currencies.model';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import {
  measureRefInitialBalanceAtBoundary,
  restampRefInitialBalance,
} from '@services/accounts/restamp-ref-initial-balance';
import {
  getLinkDayStart,
  getSeam,
  getSeamStart,
  isBeforeSeamStart,
  manualRowOnOrAfterLinkDayMessage,
  preSeamTimeOnOrAfterLinkDayMessage,
  SEAM_ACCOUNT_ATTRIBUTES,
  type SeamAccount,
} from '@services/accounts/seam';
import { withTransaction } from '@services/common/with-transaction';
import { includesCustomCurrencyCode } from '@services/currencies/custom-currency-codes';
import {
  buildDailyPairRateResolver,
  type DailyPairRateResolver,
  MS_PER_DAY,
  toDayKey,
} from '@services/exchange-rates/build-daily-pair-rate-resolver';
import { resolveCustomRate } from '@services/user-exchange-rate/get-exchange-rate.service';
import { loadCustomCurrencyDailyQuote } from '@services/user-exchange-rate/resolve-custom-pair-rate';
import Big from 'big.js';
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

/** `excludeTransactionId` drops a row a BeforeDestroy hook is removing, which still exists then. */
const excludeSql = ({ excludeTransactionId }: { excludeTransactionId?: string }) =>
  excludeTransactionId ? ` AND "id" <> :excludeTransactionId` : '';

const sumDeltas = ({ dailyDeltas }: { dailyDeltas: Map<string, Money> }) =>
  [...dailyDeltas.values()].reduce((sum, delta) => sum.add(delta), Money.zero());

const lockAccountHistory = async ({ accountId }: { accountId: string }) => {
  // Two rebuilds of the same account would otherwise interleave their writes and
  // leave the grid mixing rows from different runs.
  await connection.sequelize.query(`SELECT pg_advisory_xact_lock(hashtext(:accountId))`, {
    type: QueryTypes.SELECT,
    replacements: { accountId },
  });
};

const loadTransactionBounds = async ({
  accountId,
  before,
  excludeTransactionId,
}: {
  accountId: string;
  before?: Date;
  excludeTransactionId?: string;
}): Promise<{ earliest: Date | null; latest: Date | null }> => {
  const [row] = (await connection.sequelize.query(
    `SELECT MIN("time") AS "earliest", MAX("time") AS "latest" FROM real_transactions
      WHERE "accountId" = :accountId${before ? ` AND "time" < :before` : ''}${excludeSql({ excludeTransactionId })}`,
    { type: QueryTypes.SELECT, replacements: { accountId, before, excludeTransactionId } },
  )) as { earliest: Date | null; latest: Date | null }[];

  return {
    earliest: row?.earliest ? new Date(row.earliest) : null,
    latest: row?.latest ? new Date(row.latest) : null,
  };
};

const loadOldestStoredDay = async ({
  accountId,
  beforeDay,
}: {
  accountId: string;
  beforeDay?: string;
}): Promise<string | null> => {
  const [row] = (await connection.sequelize.query(
    `SELECT to_char(MIN("date"), 'YYYY-MM-DD') AS "day" FROM "Balances"
      WHERE "accountId" = :accountId${beforeDay ? ` AND "date" < :beforeDay` : ''}`,
    { type: QueryTypes.SELECT, replacements: { accountId, beforeDay } },
  )) as { day: string | null }[];

  return row?.day ?? null;
};

const loadDailyNativeDeltas = async ({
  accountId,
  from,
  toExclusive,
  excludeTransactionId,
}: {
  accountId: string;
  from?: Date;
  toExclusive: Date;
  excludeTransactionId?: string;
}): Promise<Map<string, Money>> => {
  const rows = (await connection.sequelize.query(
    `SELECT to_char(date_trunc('day', "time" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "day",
            ${signedAmountSql} AS "signedSum"
       FROM real_transactions
      WHERE "accountId" = :accountId${from ? ` AND "time" >= :from` : ''} AND "time" < :toExclusive${excludeSql({ excludeTransactionId })}
      GROUP BY 1`,
    { type: QueryTypes.SELECT, replacements: { accountId, from, toExclusive, excludeTransactionId } },
  )) as { day: string; signedSum: string }[];

  return new Map(rows.map((row) => [row.day, Money.fromDecimal(row.signedSum)]));
};

/** Delete before insert: a day the rebuild no longer emits must not survive and be
 *  read as a real measurement by the chart's forward fill. `ON CONFLICT` still guards
 *  the insert, because the 18:00 remeasure can pin today's row between the two. */
const writeBalanceRows = async ({
  accountId,
  fromDay,
  beforeDay,
  rows,
}: {
  accountId: string;
  fromDay: string;
  beforeDay?: string;
  rows: { date: string; amount: Money }[];
}): Promise<void> => {
  if (!rows.length) return;

  await connection.sequelize.query(
    `DELETE FROM "Balances" WHERE "accountId" = :accountId AND "date" >= :fromDay${beforeDay ? ` AND "date" < :beforeDay` : ''}`,
    { replacements: { accountId, fromDay, beforeDay } },
  );

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

type RatedAccount = Pick<Accounts, 'id' | 'userId' | 'currencyCode'>;

/** Each day's rate of an ISO currency to the owner's base currency, or null when the pair has no stored rate. */
const buildIsoRateForDay = async ({
  account,
  currencyCode,
  baseCurrencyCode,
  from,
  to,
}: {
  account: RatedAccount;
  currencyCode: string;
  baseCurrencyCode: string;
  from: Date;
  to: Date;
}): Promise<DailyPairRateResolver | null> => {
  if (currencyCode === baseCurrencyCode) return () => 1;

  const userCurrency = (await UsersCurrencies.findOne({
    where: { userId: account.userId, currencyCode },
    attributes: ['liveRateUpdate'],
    raw: true,
  })) as { liveRateUpdate: boolean | null } | null;

  // A flat manual rate wins every day of the grid, so the market resolver is built
  // only when there is no manual rate. Only that resolver can abort the rebuild.
  const flatCustomRate =
    (
      await resolveCustomRate({
        userId: account.userId,
        pair: { baseCode: currencyCode, quoteCode: baseCurrencyCode },
        liveRateUpdate: userCurrency?.liveRateUpdate ?? null,
      })
    )?.rate ?? null;
  if (flatCustomRate !== null) return () => flatCustomRate;

  const resolveRate = await buildDailyPairRateResolver({
    baseCode: currencyCode,
    quoteCode: baseCurrencyCode,
    from,
    to,
  });

  if (!resolveRate) {
    logger.warn('No stored exchange rate for pair; account left untouched', {
      accountId: account.id,
      pair: `${currencyCode}/${baseCurrencyCode}`,
    });
  }

  return resolveRate;
};

/**
 * Each day's rate to the owner's base currency, or null when the pair has no stored rate. A custom
 * currency is priced the way its transactions are: its peg or dated rate in its ISO quote that day,
 * times that quote's daily rate to the base.
 */
export const buildRateForDay = async ({
  account,
  baseCurrencyCode,
  from,
  to,
}: {
  account: RatedAccount;
  baseCurrencyCode: string;
  from: Date;
  to: Date;
}): Promise<DailyPairRateResolver | null> => {
  if (account.currencyCode === baseCurrencyCode) return () => 1;
  if (!(await includesCustomCurrencyCode({ codes: [account.currencyCode] }))) {
    return buildIsoRateForDay({ account, currencyCode: account.currencyCode, baseCurrencyCode, from, to });
  }

  const quotes = await loadCustomCurrencyDailyQuote({ userId: account.userId, code: account.currencyCode });
  if (!quotes) {
    logger.error('Custom currency has no rate; account left untouched', { accountId: account.id });
    return null;
  }

  const isoRateByQuote = new Map<string, DailyPairRateResolver | null>();
  for (const quoteCode of quotes.quoteCodes) {
    isoRateByQuote.set(
      quoteCode,
      await buildIsoRateForDay({ account, currencyCode: quoteCode, baseCurrencyCode, from, to }),
    );
  }

  return (dayKey) => {
    const quote = quotes.quoteOn(dayKey);
    const isoRate = quote ? isoRateByQuote.get(quote.quoteCode)?.(dayKey) : null;
    return quote && isoRate != null ? new Big(quote.rate).times(isoRate).toNumber() : null;
  };
};

/**
 * Daily rows from `gridStart` through `gridEnd`: native units held that day × that
 * day's rate. Sparse: a row only where the value moves, plus the first day and
 * `pinnedDayKey`. Null when a day has no rate.
 */
const buildDailyRows = async ({
  account,
  baseCurrencyCode,
  openingBalance,
  gridStart,
  gridEnd,
  dailyDeltas,
  rateForDay,
  pinnedDayKey,
}: {
  account: Accounts;
  baseCurrencyCode: string;
  openingBalance: Money;
  gridStart: Date;
  gridEnd: Date;
  dailyDeltas: Map<string, Money>;
  rateForDay: DailyPairRateResolver;
  pinnedDayKey?: string;
}): Promise<{ date: string; amount: Money }[] | null> => {
  const startKey = toDayKey(gridStart);
  const baseDecimals = await getCurrencyDecimals({ userId: account.userId, code: baseCurrencyCode });
  let nativeBalance = openingBalance;
  let lastEmitted = null as Money | null;
  const rows: { date: string; amount: Money }[] = [];

  for (let time = +gridStart; time <= +gridEnd; time += MS_PER_DAY) {
    const dayKey = toDayKey(new Date(time));
    nativeBalance = nativeBalance.add(dailyDeltas.get(dayKey) ?? Money.zero());

    const rate = rateForDay(dayKey);
    if (rate == null) {
      logger.warn('No exchange rate for day; account left untouched', {
        accountId: account.id,
        pair: `${account.currencyCode}/${baseCurrencyCode}`,
        day: dayKey,
      });
      return null;
    }

    const amount = nativeBalance.multiply(rate).roundHalfEven(baseDecimals);
    // The chart forward-fills, so a day repeating the previous value carries no
    // information. The pinned day always gets a row so the series tracks its rate.
    if (lastEmitted?.equals(amount) && dayKey !== startKey && dayKey !== pinnedDayKey) continue;

    lastEmitted = amount;
    rows.push({ date: dayKey, amount });
  }

  return rows;
};

/**
 * Written directly: `handleAccountChange` would shift the bank-owned rows from the seam on.
 * The native `initialBalance` is always written; `refInitialBalance` only when measured at
 * the ledger boundary, otherwise the previous stamp stays until the nightly sweep.
 */
const writeSeamOpeningBalance = async ({
  account,
  initialBalance,
  excludeTransactionId,
  ref,
}: {
  account: Accounts;
  initialBalance: Money;
  excludeTransactionId?: string;
  ref: 'measure' | 'no-rate' | 'no-base-currency';
}) => {
  let refInitialBalance: Money | null = null;
  let error: Error | undefined;
  if (ref === 'measure') {
    try {
      refInitialBalance = await measureRefInitialBalanceAtBoundary({ account, initialBalance, excludeTransactionId });
    } catch (e) {
      if (!(e instanceof ExchangeRateUnavailableError)) throw e;
      error = e;
    }
  }

  if (ref === 'no-base-currency') {
    logger.error(
      { message: 'No base currency for the pre-seam history; refInitialBalance left as it was' },
      { code: 'SEAM_NO_BASE_CURRENCY', accountId: account.id },
    );
  } else if (!refInitialBalance) {
    logger.error(
      { message: 'No rate for the pre-seam history; refInitialBalance stale until the nightly sweep', error },
      { code: 'SEAM_REF_INITIAL_BALANCE_STALE', accountId: account.id },
    );
  }

  await Accounts.update(
    { initialBalance, ...(refInitialBalance ? { refInitialBalance } : {}) },
    { where: { id: account.id } },
  );
};

/**
 * Rebuild the history before the bank seam backward from the stored seam balance S:
 * `initialBalance = S − Σ pre-seam rows`, and each day before the seam holds S minus
 * the pre-seam rows dated after it. `currentBalance` and every `Balances` row from
 * the seam day on belong to the bank and are never touched.
 */
const rebuildPreSeamHistoryImpl = async ({
  accountId,
  excludeTransactionId,
}: {
  accountId: string;
  excludeTransactionId?: string;
}): Promise<'rebuilt' | 'skipped'> => {
  // Row lock before the advisory lock, the order every seam writer takes them in.
  const account = await lockAccountRow({ accountId, noKey: true });
  await lockAccountHistory({ accountId });

  const seam = account && getSeam({ account });
  if (!account || !seam) return 'skipped';
  const { seamStart, seamBalance } = seam;

  const baseCurrency = await getBaseCurrency({ userId: account.userId });
  const seamDayKey = toDayKey(seamStart);
  const { earliest } = await loadTransactionBounds({ accountId, before: seamStart, excludeTransactionId });
  const oldestStoredDay = await loadOldestStoredDay({ accountId, beforeDay: seamDayKey });
  if (!earliest && !oldestStoredDay) {
    await writeSeamOpeningBalance({
      account,
      initialBalance: seamBalance,
      excludeTransactionId,
      ref: baseCurrency ? 'measure' : 'no-base-currency',
    });
    return 'rebuilt';
  }

  const gridStart = new Date(
    Math.min(
      earliest ? +utcDayStart(earliest) - MS_PER_DAY : Infinity,
      oldestStoredDay ? +dayKeyToDate(oldestStoredDay) : Infinity,
    ),
  );
  const gridEnd = new Date(+seamStart - MS_PER_DAY);

  const dailyDeltas = await loadDailyNativeDeltas({
    accountId,
    from: gridStart,
    toExclusive: seamStart,
    excludeTransactionId,
  });
  const initialBalance = seamBalance.subtract(sumDeltas({ dailyDeltas }));

  const rateForDay = baseCurrency
    ? await buildRateForDay({ account, baseCurrencyCode: baseCurrency.currencyCode, from: gridStart, to: gridEnd })
    : null;
  const rows =
    baseCurrency && rateForDay
      ? await buildDailyRows({
          account,
          baseCurrencyCode: baseCurrency.currencyCode,
          openingBalance: initialBalance,
          gridStart,
          gridEnd,
          dailyDeltas,
          rateForDay,
        })
      : null;

  // Without a rate only the native opening balance moves; the nightly sweep retries the rest.
  await writeSeamOpeningBalance({
    account,
    initialBalance,
    excludeTransactionId,
    ref: rows ? 'measure' : baseCurrency ? 'no-rate' : 'no-base-currency',
  });
  if (!rows) return 'skipped';

  await writeBalanceRows({ accountId, fromDay: toDayKey(gridStart), beforeDay: seamDayKey, rows });

  return 'rebuilt';
};

/**
 * Rewrite an account's daily `Balances` rows as "native units held that day × that
 * day's rate to the owner's base currency", from the day before its first transaction
 * (or its oldest stored row) through today (or its last transaction). An account with
 * a bank seam gets only its pre-seam history rebuilt.
 *
 * Every row in the range the output does not cover is deleted, so the chart's forward
 * fill reads exactly what the rebuild computed.
 */
const revalueBalanceHistoryImpl = async ({
  accountId,
  excludeTransactionId,
}: {
  accountId: string;
  excludeTransactionId?: string;
}): Promise<'rebuilt' | 'skipped'> => {
  const account = await Accounts.findByPk(accountId);
  if (!account) return 'skipped';

  if (getSeamStart({ account })) return rebuildPreSeamHistoryImpl({ accountId, excludeTransactionId });

  const baseCurrency = await getBaseCurrency({ userId: account.userId });
  if (!baseCurrency || !isRevaluedAccount({ account, baseCurrencyCode: baseCurrency.currencyCode })) return 'skipped';

  await lockAccountHistory({ accountId });

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

  const rateForDay = await buildRateForDay({
    account,
    baseCurrencyCode: baseCurrency.currencyCode,
    from: gridStart,
    to: gridEnd,
  });
  if (!rateForDay) return 'skipped';

  const dailyDeltas = await loadDailyNativeDeltas({
    accountId,
    from: gridStart,
    toExclusive: new Date(+gridEnd + MS_PER_DAY),
  });

  const rows = await buildDailyRows({
    account,
    baseCurrencyCode: baseCurrency.currencyCode,
    openingBalance: account.initialBalance,
    gridStart,
    gridEnd,
    dailyDeltas,
    rateForDay,
    pinnedDayKey: toDayKey(today),
  });
  if (!rows) return 'skipped';

  await writeBalanceRows({ accountId, fromDay: toDayKey(gridStart), rows });

  return 'rebuilt';
};

export const revalueBalanceHistory = withTransaction(revalueBalanceHistoryImpl);

interface RevalueBatch {
  accountIds: Set<string>;
  seamAccounts: Map<string, SeamAccount | null>;
  closed: boolean;
}

const revalueBatchStorage = new AsyncLocalStorage<RevalueBatch>();

const openBatch = (): RevalueBatch | undefined => {
  const batch = revalueBatchStorage.getStore();
  return batch && !batch.closed ? batch : undefined;
};

const forgetSeamAccount = ({ accountId }: { accountId: string }) => {
  revalueBatchStorage.getStore()?.seamAccounts.delete(accountId);
};

/** The account's seam attributes, read once per batch scope; S changes only through stamp and clear. */
export const findSeamAccount = async ({ accountId }: { accountId: string }): Promise<SeamAccount | null> => {
  const batch = openBatch();
  if (batch?.seamAccounts.has(accountId)) return batch.seamAccounts.get(accountId)!;

  const account = await Accounts.findByPk(accountId, { attributes: [...SEAM_ACCOUNT_ATTRIBUTES] });
  batch?.seamAccounts.set(accountId, account);
  return account;
};

/**
 * Stores the seam balance S once linking has absorbed its residual:
 * `initialBalance + Σ signed(real rows dated before the link day)`, and rebuilds the history before it.
 */
export const stampSeamBalance = withTransaction(async ({ accountId }: { accountId: string }): Promise<void> => {
  const account = await Accounts.findByPk(accountId);
  const linkDayStart = account && getLinkDayStart({ externalData: account.externalData });
  if (!account || account.type === ACCOUNT_TYPES.system) return;
  if (!linkDayStart) {
    logger.warn('Seam balance not stamped: account has no forward-only link day', { accountId });
    return;
  }

  const preSeamDeltas = await loadDailyNativeDeltas({ accountId, toExclusive: linkDayStart });
  await Accounts.update(
    { seamBalance: account.initialBalance.add(sumDeltas({ dailyDeltas: preSeamDeltas })) },
    { where: { id: accountId } },
  );
  forgetSeamAccount({ accountId });
  // In this transaction, not via scheduleBalanceRevalue: a scheduled rebuild is lost on the queued link path.
  await rebuildPreSeamHistoryImpl({ accountId });
});

/**
 * Drops S, first rebuilding the history before the link day from it one last time when the
 * account has a seam: once S is gone a rebuild is a no-op.
 */
export const clearSeam = withTransaction(async ({ accountId }: { accountId: string }): Promise<void> => {
  const account = await lockAccountRow({ accountId, noKey: true });
  if (account && getSeam({ account }) && (await rebuildPreSeamHistoryImpl({ accountId })) === 'skipped') {
    await restampRefInitialBalance({ accountId, allowProviderAccount: true });
  }
  await Accounts.update({ seamBalance: null }, { where: { id: accountId } });
  forgetSeamAccount({ accountId });
});

/**
 * Collapse every revalue scheduled inside `fn` into one rebuild per account, run after
 * `fn` settles. Opened at entrypoints (HTTP controllers, cron and queue job bodies).
 *
 * Rebuilds run even when `fn` throws, since rows that did commit still need healing,
 * and the original error is rethrown. Nested scopes merge into the outermost one.
 */
export const runWithBalanceRevalueBatch = async <R>(fn: () => Promise<R>): Promise<R> => {
  if (openBatch()) return fn();

  const batch: RevalueBatch = { accountIds: new Set(), seamAccounts: new Map(), closed: false };
  try {
    return await revalueBatchStorage.run(batch, fn);
  } finally {
    for (const accountId of batch.accountIds) {
      try {
        await revalueBalanceHistory({ accountId });
      } catch (error) {
        // The data is already committed; a failed rebuild leaves stale rows for
        // the nightly revalue job to correct rather than killing the process.
        logger.error(
          { message: 'Balance revalue failed after batch; stale until the nightly sweep', error: error as Error },
          { code: 'BALANCE_REVALUE_BATCH_FAILED', accountId },
        );
      }
    }
    batch.closed = true;
  }
};

/**
 * Defer the rebuild to the end of the surrounding batch scope, or run it inline when
 * there is none. Inline under an ambient CLS transaction it joins that transaction, so
 * the rebuild commits together with the change that triggered it.
 */
export const scheduleBalanceRevalue = async ({
  accountId,
  excludeTransactionId,
}: {
  accountId: string;
  excludeTransactionId?: string;
}): Promise<void> => {
  const batch = openBatch();
  if (batch) {
    batch.accountIds.add(accountId);
    return;
  }

  await revalueBalanceHistory({ accountId, excludeTransactionId });
};

/**
 * True when the account has a bank seam, which owns the balance from the seam on. Times
 * before the seam schedule its rebuild. A manual row may not cross the seam (`edit`), nor
 * land from the seam on (`enter-ledger`); a `bank-row` may do both.
 */
export const schedulePreSeamRebuild = async ({
  accountId,
  times,
  excludeTransactionId,
  mode = 'edit',
}: {
  accountId: string;
  times: (Date | string)[];
  excludeTransactionId?: string;
  mode?: 'edit' | 'enter-ledger' | 'bank-row';
}): Promise<boolean> => {
  const account = await findSeamAccount({ accountId });
  const seamStart = account && getSeamStart({ account });
  if (!seamStart) return false;

  const preSeamCount = times.filter((time) => isBeforeSeamStart({ seamStart, time })).length;
  if (preSeamCount === 0) {
    if (mode === 'enter-ledger' && times.length)
      throw new ValidationError({ message: manualRowOnOrAfterLinkDayMessage({ seamStart, isNewRow: true }) });
    return true;
  }
  if (preSeamCount < times.length && mode !== 'bank-row') {
    throw new ValidationError({ message: preSeamTimeOnOrAfterLinkDayMessage({ seamStart }) });
  }

  await scheduleBalanceRevalue({ accountId, excludeTransactionId });
  return true;
};
