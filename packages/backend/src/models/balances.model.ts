import {
  TRANSACTION_TYPES,
  ACCOUNT_TYPES,
  ACCOUNT_CATEGORIES,
  TRANSACTION_TRANSFER_NATURE,
  RecordId,
} from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField, toMoneyColumnValue } from '@common/types/money-column';
import { logger } from '@js/utils';
import { runInSavepoint } from '@services/common/run-in-savepoint';
import { getExchangeRate } from '@services/user-exchange-rate/get-exchange-rate.service';
import { subDays, startOfMonth, startOfDay } from 'date-fns';
import { Op, UniqueConstraintError } from 'sequelize';
import { Model, Column, DataType, ForeignKey, BelongsTo, Table } from 'sequelize-typescript';
import { v7 as uuidv7 } from 'uuid';

import Accounts from './accounts.model';
import Transactions, { TransactionsAttributes } from './transactions.model';
import { getBaseCurrency } from './users-currencies.model';

interface GetTotalBalanceHistoryPayload {
  startDate: Date;
  endDate: Date;
  accountIds: string[];
}

@Table({ timestamps: true, tableName: 'Balances', freezeTableName: true })
export default class Balances extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @Column({
    allowNull: false,
    type: DataType.DATEONLY,
  })
  date!: Date;

  /**
   * Representation of the account balance at the specific date. Each time a new
   * transaction is being added, changed or removed, we update account balance,
   * and also this `amount` field, so that we always have actual balance for the
   * specific date.
   * `amount` is in the BASE currency. So it represents a `refAmount` (`refBalance`)
   */
  @MoneyField({ storage: 'decimal', precision: 36, scale: 18 })
  declare amount: Money;

  @ForeignKey(() => Accounts)
  @Column({ allowNull: false, type: DataType.UUID })
  accountId!: RecordId;

  @BelongsTo(() => Accounts)
  account!: Accounts;

  // Method to calculate the total balance across all accounts
  static async getTotalBalance({ userId }: { userId: number }): Promise<number> {
    const userAccounts = await Accounts.findAll({ where: { userId: userId } });
    const accountIds = userAccounts.map((account) => account.id);

    const result = await Balances.sum('amount', {
      where: { accountId: accountIds },
    });

    return result || 0;
  }

  // Method to retrieve total balance history for specified dates and accounts
  static async getTotalBalanceHistory(payload: GetTotalBalanceHistoryPayload): Promise<Balances[]> {
    const { startDate, endDate, accountIds } = payload;
    return Balances.findAll({
      where: {
        date: {
          [Op.between]: [startDate, endDate],
        },
        accountId: accountIds,
      },
      order: [['date', 'ASC']],
      include: [Accounts],
    });
  }

  // Transactions might have positive and negative amount
  // ### Transaction creation
  // 1. ✅ If just a new tx is created. Create a new record with date and (amount + refAmount) of tx
  // 2. ✅ If new tx is created, but there's already record for that date, then just update the record's amount
  // 3. ✅ If new tx is created, but there's no record before that day, then create one
  //      more record to represent accounts' initialBalance and record for the transaction itself

  // ### Transaction updation
  // 1. ✅ If tx amount, data, accountId, or transactionType is updated, update balances correspondingly

  // ### Transaction deletion
  // 1. ✅ If tx is deleted, update balances for all records correspondingly

  // ### Account creation
  // 1. ✅ Add a new record to Balances table with a `currentBalance` that is specified in Accounts table

  // ### Account deletion will be handled by `cascade` deletion
  //
  // Bank-provider accounts use a two-layer balance-population scheme. Per-tx
  // hooks below (Monobank, Enable Banking) backfill historical days as
  // transactions land – that is how the analytics chart gets in-between days
  // populated, not just "today". The authoritative end-of-sync write goes
  // through `writeBankBalanceWithHistory`
  // (services/bank-data-providers/utils/), which writes
  // `Accounts.currentBalance` + `refCurrentBalance` and overwrites today's
  // `Balances` row with the bank's reported balance. For providers whose
  // upstream has no per-transaction balance (LunchFlow, Walutomat, SimpleFIN)
  // only the authoritative layer runs – the chart fills in over time as new
  // syncs land each day. Either layer races safely against the other via the
  // unique `(accountId, date)` index plus `INSERT ... ON CONFLICT DO UPDATE`
  // in `updateAccountBalance`.
  static async handleTransactionChange({
    data,
    prevData,
    isDelete = false,
  }: {
    data: Transactions;
    prevData?: Transactions;
    isDelete?: boolean;
  }) {
    const { accountId, time } = data;
    // A row without a base-currency amount (a custom currency with no rate yet) moves no balance.
    const refAmount = data.refAmount ?? Money.zero();
    let amount: Money = data.transactionType === TRANSACTION_TYPES.income ? refAmount : refAmount.negate();
    const date = startOfDay(new Date(time));

    switch (data.accountType) {
      case ACCOUNT_TYPES.system: {
        // Loan balances + history are owned by `recomputeLoanBalance`, which
        // writes the loan's Balances rows directly — skip the loan's own payment
        // leg here. A `transfer_to_loan` income leg only ever lives on a loan
        // account, so no account lookup is needed on this hot path.
        if (
          data.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan &&
          data.transactionType === TRANSACTION_TYPES.income
        ) {
          break;
        }

        // Lazy import: the service reads accounts and rates, so a static import
        // would close a model→service→model cycle at load time.
        const { isRevaluedAccount, scheduleBalanceRevalue } =
          await import('@services/balances/revalue-balance-history.service');

        // A foreign-currency account can't be cascaded: every later day has to be
        // re-valued at its own rate, so it is rebuilt wholesale instead.
        const affectedAccounts = new Map<
          string,
          { account: Accounts; ownerBaseCode: string | undefined; isRevalued: boolean }
        >();
        for (const affectedAccountId of new Set([accountId, ...(prevData ? [prevData.accountId] : [])])) {
          const account = await Accounts.findOne({ where: { id: affectedAccountId } });
          if (!account) continue;

          const ownerBaseCode = (await getBaseCurrency({ userId: account.userId }))?.currencyCode;
          affectedAccounts.set(affectedAccountId, {
            account,
            ownerBaseCode,
            isRevalued: !!ownerBaseCode && isRevaluedAccount({ account, baseCurrencyCode: ownerBaseCode }),
          });
        }

        if (isDelete) {
          amount = amount.negate(); // Reverse the amount if it's a deletion
        } else if (prevData) {
          const originalDate = startOfDay(new Date(prevData.time));
          const prevRefAmount = prevData.refAmount ?? Money.zero();
          const originalAmount =
            prevData.transactionType === TRANSACTION_TYPES.income ? prevRefAmount : prevRefAmount.negate();

          if (
            // If the account ID changed,
            accountId !== prevData.accountId ||
            // the date changed,
            +date !== +originalDate ||
            // the transaction type changed,
            data.transactionType !== prevData.transactionType ||
            // or the amount changed
            !amount.isZero()
            // THEN remove the original transaction
          ) {
            if (!affectedAccounts.get(prevData.accountId)?.isRevalued) {
              await this.updateBalanceIncremental({
                accountId: prevData.accountId,
                date: originalDate,
                amount: originalAmount.negate(),
              });
            }
          }
        }

        // Update the balance for the current account and date
        if (!affectedAccounts.get(accountId)?.isRevalued) {
          await this.updateBalanceIncremental({
            accountId,
            date,
            amount,
          });
        }

        // The incremental cascade folded this transaction's historical-rate
        // `refAmount` into today's row, but today's row is a STOCK: it must equal
        // the account card's spot `refCurrentBalance` (native × latest rate). Re-pin
        // each affected account to the spot value already written by the
        // account-balance hook. A moved transaction touches its old and new account,
        // so both are re-pinned.
        for (const [clampAccountId, { account: clampAccount, ownerBaseCode, isRevalued }] of affectedAccounts) {
          // A revalued account gets its whole grid, today's row included, from the rebuild.
          if (isRevalued) {
            await scheduleBalanceRevalue({ accountId: clampAccountId });
            continue;
          }

          // Whether today's row still needs re-pinning. The one case that does NOT
          // is an identity-rate cascade in the OWNER's base currency: the account is
          // in the owner's base AND this cascade folded a same-base `refAmount`
          // (rate 1), so the row already sits at the spot balance — and skipping it
          // preserves the row's race-safe atomic accumulation. The row's stamped
          // `refCurrencyCode` alone can't decide this: on a shared account a
          // recipient authors rows under their own base, so it carries the AUTHOR's
          // base, not the owner's. The skip therefore requires the account currency,
          // the row's ref currency, AND the owner's actual base to all agree. Loans
          // no-op inside `setTodayRowToSpot`.
          const isOwnerBaseIdentityCascade =
            clampAccount.currencyCode === data.refCurrencyCode && clampAccount.currencyCode === ownerBaseCode;

          if (!isOwnerBaseIdentityCascade) {
            await this.setTodayRowToSpot({ account: clampAccount });
          }
        }
        break;
      }

      case ACCOUNT_TYPES.monobank: {
        // Per-tx backfill layer. Each Monobank transaction carries the bank's
        // post-tx balance in `externalData.balance` (in account currency, e.g.
        // UAH). Convert to base currency via the exchange-rate service and
        // upsert the day's `Balances` row – last tx processed for a date wins
        // the end-of-day value. The end-of-sync `writeBankBalanceWithHistory`
        // call (worker) then overwrites today's row with the bank's
        // authoritative balance.
        // TODO: we probably need to avoid updating opposite_tx refAmount based on
        // original-tx refAmount
        const balance = (data.externalData as TransactionsAttributes['externalData']).balance;

        if (balance !== undefined) {
          const exchangeRateData = await getExchangeRate({
            userId: data.userId,
            date,
            baseCode: data.currencyCode,
            quoteCode: data.refCurrencyCode,
          });
          // Monobank reports the balance in minor units (cents) of the account currency.
          const refBalance = Money.fromCents(balance)
            .multiply(exchangeRateData.rate)
            .roundHalfEven(await getCurrencyDecimals({ userId: data.userId, code: data.refCurrencyCode }));

          await this.updateAccountBalance({ accountId, date, refBalance });
        }
        break;
      }

      case ACCOUNT_TYPES.enableBanking: {
        // No per-tx write. `balance_after_transaction` is a running book balance,
        // so which row of a booking day closes it can only be decided with the
        // whole day in hand – `reconcileDailyClosingBalances` does that at the end
        // of each sync and owns these rows outright. Writing per transaction here
        // would leave an arbitrary mid-day figure standing on any day that pass
        // declines to resolve, where no row at all is the honest answer and the
        // chart carries the previous day forward.
        break;
      }

      case ACCOUNT_TYPES.lunchflow:
      case ACCOUNT_TYPES.walutomat:
      case ACCOUNT_TYPES.simplefin: {
        // No per-tx balance from upstream – only the authoritative end-of-sync
        // `writeBankBalanceWithHistory` writes for these providers. Chart
        // gaps for past days fill in over time as new syncs land each day.
        break;
      }

      default: {
        const exhaustiveCheck: never = data.accountType;

        if (process.env.NODE_ENV === 'development') {
          throw new Error(`Unhandled account type in handleTransactionChange: ${exhaustiveCheck}`);
        } else {
          logger.error(`Unhandled account type in handleTransactionChange: ${exhaustiveCheck}`);
        }
        console.log('default');
      }
    }
  }

  /**
   * Update balance for system accounts using INCREMENTAL amount changes.
   *
   * This method is specifically for ACCOUNT_TYPES.system where transactions
   * incrementally affect balance. It differs from updateAccountBalance() which
   * sets an absolute value.
   *
   * Key behaviors:
   * - Takes an incremental `amount` (positive for income, negative for expense)
   * - Adds the amount to the existing balance (not replaces it)
   * - Cascades changes to all future dates (updates all records after this date)
   * - Creates first-of-month records for easier period calculations
   *
   * For external bank providers (Monobank, EnableBanking), use updateAccountBalance()
   * which sets an absolute balance value without cascading.
   */
  private static async updateBalanceIncremental({
    accountId,
    date,
    amount,
  }: {
    accountId: string;
    date: Date;
    amount: Money;
  }) {
    // If there's no record for the 1st of the month, create it based on the closest record prior it
    // so it's easier to calculate stats for the period
    const firstDayOfMonth = startOfMonth(new Date(date));
    const firstDayBalance = await this.findOne({
      where: {
        accountId,
        date: firstDayOfMonth,
      },
    });

    if (!firstDayBalance) {
      const latestBalancePrior = await this.findOne({
        where: {
          date: {
            [Op.lt]: firstDayOfMonth,
          },
          accountId,
        },
        attributes: ['amount'],
        order: [['date', 'DESC']],
      });

      if (latestBalancePrior) {
        try {
          await runInSavepoint(() =>
            this.create({
              accountId,
              date: firstDayOfMonth,
              amount: latestBalancePrior.amount,
            }),
          );
        } catch (err) {
          if (!(err instanceof UniqueConstraintError)) throw err;
          // Seed row computed from the same `latestBalancePrior` by every
          // racing writer – the existing row already carries the right seed.
        }
      }
    }

    // Try to find an existing balance for the account and date
    let balanceForTxDate = await this.findOne({
      where: {
        accountId,
        date,
      },
    });

    // If history record has previous amount, it means it's updating,
    // so we need to set newAmount - oldAmount
    if (!balanceForTxDate) {
      // If there's not balance for current tx data, we trying to find a balance
      // prior tx date
      const latestBalancePrior = await this.findOne({
        where: {
          date: {
            [Op.lt]: date,
          },
          accountId,
        },
        order: [['date', 'DESC']],
      });

      // If there's no balance prior tx date, it means that we're adding
      // the youngest transaction, aka the 1st one, so we need to check a balance
      // that comes prior it
      if (!latestBalancePrior) {
        // Example of how this logic should work like
        // Initially we had 100 at 10-10-23
        // Then we added 10 at 11-10-23, so 11-10-23 is now 100 + 10 = 110
        // Then we wanna add -10 at 9-10-23, so that we need to:
        // 1. Create a record for 8-10-23, with amount of 100 (so it will represent the initialBalance of account)
        // 2. Then create a record for 9-10-23 (our tx date), we correct amount
        // 3. Then update all future amounts
        const account = await Accounts.findOne({
          where: { id: accountId },
        });

        // (1) Firstly we now need to create one more record that will represent the
        // balance before that transaction
        try {
          await runInSavepoint(() =>
            this.create({
              accountId,
              date: subDays(new Date(date), 1),
              amount: account!.refInitialBalance ?? Money.zero(),
            }),
          );
        } catch (err) {
          if (!(err instanceof UniqueConstraintError)) throw err;
          // Seed row computed from the same `refInitialBalance` by every
          // racing writer – the existing row already carries the right seed.
        }

        // (2) Then we create a record for that transaction
        try {
          await runInSavepoint(() =>
            this.create({
              accountId,
              date,
              amount: (account!.refInitialBalance ?? Money.zero()).add(amount),
            }),
          );
        } catch (err) {
          if (!(err instanceof UniqueConstraintError)) throw err;
          await this.applyIncrementAtSql({ accountId, date, delta: amount });
        }
      } else {
        try {
          balanceForTxDate = await runInSavepoint(() =>
            this.create({
              accountId,
              date,
              amount: latestBalancePrior.amount.add(amount),
            }),
          );
        } catch (err) {
          if (!(err instanceof UniqueConstraintError)) throw err;
          await this.applyIncrementAtSql({ accountId, date, delta: amount });
        }
      }
    } else {
      await this.applyIncrementAtSql({ accountId, date, delta: amount });
    }

    // Update the amount of all balances for the account that come after the date
    await this.update(
      { amount: Balances.sequelize!.literal(`amount + (${toMoneyColumnValue({ money: amount })})`) },
      {
        where: {
          accountId,
          date: {
            [Op.gt]: date,
          },
        },
      },
    );
  }

  /**
   * Handles balance records when an account is created or its initial balance is updated.
   *
   * - **Account creation**: Creates the first balance record for today with the account's
   *   initial balance (refInitialBalance).
   * - **Initial balance update**: Adjusts all existing balance records by the difference
   *   between old and new initial balance, maintaining correct historical balances.
   *
   * @param account - The account being created or updated
   * @param prevAccount - The previous account state (undefined for new accounts)
   */
  static async handleAccountChange({ account, prevAccount }: { account: Accounts; prevAccount?: Accounts }) {
    const { id: accountId } = account;
    // An account whose opening balance has no base-currency value yet (a custom currency without
    // a rate) contributes nothing to the history.
    const refInitialBalance = account.refInitialBalance ?? Money.zero();

    // Try to find an existing balance for the account
    const record = await this.findOne({
      where: {
        accountId,
      },
    });

    // If record exists, then it's account updating, otherwise account creation
    if (record && prevAccount) {
      const diff = refInitialBalance.subtract(prevAccount.refInitialBalance ?? Money.zero());

      // Update history for all the records related to that account
      await this.update(
        { amount: Balances.sequelize!.literal(`amount + (${toMoneyColumnValue({ money: diff })})`) },
        {
          where: { accountId },
        },
      );
    } else {
      const date = startOfDay(new Date());

      // If no balance exists yet, create one with the account's current balance
      await this.create({
        accountId,
        date,
        amount: refInitialBalance,
      });
    }
  }

  // SQL-side `amount += delta` against the `(accountId, date)` row. Used in
  // place of `findOne → save` so a concurrent cascade UPDATE (`Op.gt:
  // olderDate` from another writer's later step) can't slip in and clobber.
  private static async applyIncrementAtSql({
    accountId,
    date,
    delta,
  }: {
    accountId: string;
    date: Date;
    delta: Money;
  }): Promise<void> {
    await Balances.sequelize!.query(
      `UPDATE "Balances"
       SET "amount" = "amount" + :delta, "updatedAt" = NOW()
       WHERE "accountId" = :accountId AND "date" = :date`,
      {
        replacements: {
          delta: toMoneyColumnValue({ money: delta }),
          accountId,
          date,
        },
      },
    );
  }

  /**
   * Update account balance with an absolute value (not incremental).
   * Used by external bank providers (e.g., Monobank, EnableBanking) to set balance
   * based on transaction's balance_after or the authoritative balance from bank's API.
   *
   * Transactions should be sorted by time before processing so the last transaction
   * for each day sets the correct end-of-day balance.
   *
   * Race-safe via the `balances_account_id_date_unique` index on (accountId, date)
   * paired with `INSERT ... ON CONFLICT DO UPDATE` – concurrent writers (auto-sync
   * vs. user-clicked refresh, multi-batch BullMQ workers, concurrent syncs
   * across a connection's accounts, the per-tx `@AfterCreate` hook firing
   * alongside the end-of-sync write) serialize on the unique index and the last writer's
   * `refBalance` wins. The raw query is used instead of `Model.upsert` to
   * guarantee `id` and `createdAt` are NOT overwritten when the conflict path
   * fires.
   *
   * @param accountId - The account to update
   * @param date - The date for the balance record
   * @param refBalance - The balance amount in base currency
   */
  static async updateAccountBalance({
    accountId,
    date,
    refBalance,
  }: {
    accountId: string;
    date: Date;
    refBalance: Money;
  }) {
    const normalizedDate = startOfDay(date);

    await Balances.sequelize!.query(
      `INSERT INTO "Balances" ("id", "accountId", "date", "amount", "createdAt", "updatedAt")
       VALUES (:id, :accountId, :date, :amount, NOW(), NOW())
       ON CONFLICT ("accountId", "date") DO UPDATE
       SET "amount" = EXCLUDED."amount", "updatedAt" = NOW()`,
      {
        replacements: {
          id: uuidv7(),
          accountId,
          date: normalizedDate,
          amount: toMoneyColumnValue({ money: refBalance }),
        },
      },
    );
  }

  /**
   * Pin TODAY's net-worth history row for an account to its spot `refCurrentBalance`
   * (native balance × latest rate). Today's row is a STOCK: it must equal the
   * account card's base-currency balance, not the running sum of historical-rate
   * `refAmount`s the cascade folds in (an account drained to zero would otherwise
   * keep a nonzero residue). Absolute upsert on `(accountId, today)`, never an
   * increment. Past rows are untouched — historical measurements at their own rates.
   *
   * Callers pass an account row read AFTER the spot `refCurrentBalance` write so this
   * observes the fresh value; the upsert joins the ambient CLS transaction via
   * `updateAccountBalance`.
   *
   * Loans are excluded for every caller: a loan owns its whole Balances history
   * through `recomputeLoanBalance`'s destroy + rebuild replay, so a spot pin would
   * fight that writer. Centralising the skip here keeps any caller from pinning a
   * loan's today row.
   */
  static async setTodayRowToSpot({ account }: { account: Accounts }): Promise<void> {
    if (account.accountCategory === ACCOUNT_CATEGORIES.loan) return;
    // No spot value to pin while a custom currency has no rate.
    if (account.refCurrentBalance == null) return;

    await this.updateAccountBalance({
      accountId: account.id,
      date: startOfDay(new Date()),
      refBalance: account.refCurrentBalance,
    });
  }
}
