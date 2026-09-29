import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  BLANK_FILTER_VALUE,
  CategorizationMeta,
  CATEGORIZATION_SOURCE,
  FILTER_OPERATION,
  PAYMENT_TYPES,
  RecordId,
  SORT_DIRECTIONS,
  TRANSACTION_SORT_FIELD,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TransactionCreatorSnapshot,
  TransactionLocation,
  TransactionModel,
} from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import BudgetTransactions from '@models/budget-transactions.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import Currencies from '@models/currencies.model';
import LoanDetails from '@models/loan-details.model';
import Payees from '@models/payees.model';
import Tags from '@models/tags.model';
import TransactionGroupItems from '@models/transaction-group-items.model';
import TransactionGroups, { dissolveUndersizedGroups } from '@models/transaction-groups.model';
import TransactionSplits from '@models/transaction-splits.model';
import TransactionTags from '@models/transaction-tags.model';
import { hasBalanceRelevantChange } from '@models/transactions-balance-relevance';
import {
  BalanceAdjustmentsPolicy,
  CompletenessPolicy,
  ExcludedAccountsPolicy,
  PlannedPolicy,
  WhereAccessPolicy,
} from '@models/transactions-query/policies';
// `where-builders` is model-free by design, so the model can share the boundary's policy
// clauses without an import cycle through `transactions-query/index`.
import {
  balanceAdjustmentsWhere,
  callerFrame,
  capPolicy,
  completenessToPagination,
  isEmptyFragment,
  plannedWhere,
} from '@models/transactions-query/where-builders';
import Users from '@models/users.model';
import { updateAccountBalanceForChangedTx } from '@services/accounts/update-balance-for-changed-tx';
import {
  Op,
  FindAttributeOptions,
  Includeable,
  Order,
  ProjectionAlias,
  WhereOptions,
  literal,
  where as sequelizeWhere,
} from 'sequelize';
import {
  Table,
  BeforeCreate,
  AfterCreate,
  AfterUpdate,
  AfterDestroy,
  BeforeDestroy,
  BeforeUpdate,
  Column,
  Model,
  Length,
  ForeignKey,
  DataType,
  BelongsTo,
  BelongsToMany,
  HasMany,
} from 'sequelize-typescript';

const prepareTXInclude = ({ includeSplits, includeTags }: { includeSplits?: boolean; includeTags?: boolean }) => {
  const include: Includeable[] = [];

  if (includeSplits) {
    include.push({
      model: TransactionSplits,
      as: 'splits',
      include: [{ model: Categories, as: 'category' }],
    });
  }

  if (includeTags) {
    include.push({
      model: Tags,
      through: { attributes: [] },
      attributes: ['id', 'name', 'color', 'icon'],
    });
  }

  return include;
};

export interface TransactionsAttributes {
  id: string;
  amount: Money;
  /** Amount in user's base currency */
  refAmount: Money;
  note: string;
  externalUrl: string | null;
  externalReference: string | null;
  location: TransactionLocation | null;
  time: Date;
  userId: number;
  transactionType: TRANSACTION_TYPES;
  paymentType: PAYMENT_TYPES;
  accountId: string;
  categoryId: string;
  currencyCode: string;
  accountType: ACCOUNT_TYPES;
  refCurrencyCode: string;

  // is transaction transfer?
  transferNature: TRANSACTION_TRANSFER_NATURE;
  // (hash, used to connect two transactions, to easily search the opposite tx)
  transferId: string;

  originalId: string; // Stores the original id from external source
  // JSON of any addition fields
  externalData: {
    operationAmount?: number;
    balance?: number;
    hold?: boolean;
    receiptId?: string;
    /** Set on transactions created by the balance-adjustment flow. */
    balanceAdjustment?: boolean;
    /** Set when the row was created with `applyAutomations`; keeps it automation-eligible. */
    applyAutomations?: boolean;
  } & Record<string, unknown>;
  commissionRate: Money;
  refCommissionRate: Money;
  cashbackAmount: Money;
  originalAmount: Money | null;
  originalCurrencyCode: string | null;
  refundLinked: boolean;
  isPlanned: boolean;
  categorizationMeta: CategorizationMeta | null;
  payeeId: string | null;
  payeeLocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Table({
  timestamps: true,
  // Hard deletes must pass `force: true` (or go through destroyTransactions / deleteTransactionById);
  // without it Sequelize only sets `deletedAt`.
  paranoid: true,
  tableName: 'Transactions',
  freezeTableName: true,
})
export default class Transactions extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @MoneyField({ storage: 'cents' })
  declare amount: Money;

  // Amount in curreny of account
  @MoneyField({ storage: 'cents' })
  declare refAmount: Money;

  @Length({ max: 2000 })
  @Column({ allowNull: true, type: DataType.STRING })
  note!: string;

  @Column({ allowNull: true, type: DataType.STRING(2048) })
  externalUrl!: string | null;

  @Column({ allowNull: true, type: DataType.STRING(255) })
  externalReference!: string | null;

  @Column({ allowNull: true, type: DataType.JSONB })
  location!: TransactionLocation | null;

  @Column({
    defaultValue: Date.now(),
    allowNull: false,
    type: DataType.DATE,
  })
  time!: Date;

  @ForeignKey(() => Users)
  @Column({ type: DataType.INTEGER })
  userId!: number;

  @Column({ type: DataType.JSONB, allowNull: true, defaultValue: null })
  creatorSnapshot!: TransactionCreatorSnapshot | null;

  @BelongsToMany(() => Budgets, {
    through: { model: () => BudgetTransactions, unique: false },
    foreignKey: 'transactionId',
    otherKey: 'budgetId',
  })
  budgets!: Budgets[];

  @BelongsToMany(() => Tags, {
    through: { model: () => TransactionTags, unique: false },
    foreignKey: 'transactionId',
    otherKey: 'tagId',
  })
  tags!: Tags[];

  @BelongsToMany(() => TransactionGroups, {
    through: { model: () => TransactionGroupItems, unique: false },
    foreignKey: 'transactionId',
    otherKey: 'groupId',
  })
  transactionGroups!: TransactionGroups[];

  @HasMany(() => TransactionSplits)
  splits!: TransactionSplits[];

  @Column({
    allowNull: false,
    defaultValue: TRANSACTION_TYPES.income,
    type: DataType.ENUM(...Object.values(TRANSACTION_TYPES)),
  })
  transactionType!: TRANSACTION_TYPES;

  @Column({
    allowNull: false,
    defaultValue: PAYMENT_TYPES.creditCard,
    type: DataType.ENUM(...Object.values(PAYMENT_TYPES)),
  })
  paymentType!: PAYMENT_TYPES;

  @ForeignKey(() => Accounts)
  @Column({ allowNull: true, type: DataType.UUID })
  accountId!: RecordId;

  @BelongsTo(() => Accounts)
  account!: Accounts;

  @ForeignKey(() => Categories)
  @Column({ allowNull: true, type: DataType.UUID })
  categoryId!: RecordId;

  @BelongsTo(() => Categories)
  category!: Categories;

  @ForeignKey(() => Currencies)
  @Column({ allowNull: true, type: DataType.STRING(3) })
  currencyCode!: string;

  @Column({
    allowNull: false,
    defaultValue: ACCOUNT_TYPES.system,
    type: DataType.ENUM(...Object.values(ACCOUNT_TYPES)),
  })
  accountType!: ACCOUNT_TYPES;

  @ForeignKey(() => Currencies)
  @Column({ allowNull: true, defaultValue: null, type: DataType.STRING(3) })
  refCurrencyCode!: string;

  @Column({
    type: DataType.STRING(50),
    allowNull: false,
    defaultValue: TRANSACTION_TRANSFER_NATURE.not_transfer,
    validate: { isIn: [Object.values(TRANSACTION_TRANSFER_NATURE)] },
  })
  transferNature!: TRANSACTION_TRANSFER_NATURE;

  // (hash, used to connect two transactions)
  @Column({ allowNull: true, defaultValue: null, type: DataType.STRING })
  transferId!: RecordId;

  // Stores the original id from external source
  @Column({
    allowNull: true,
    type: DataType.STRING,
  })
  originalId!: string;

  // Stores the data from external source
  @Column({
    type: DataType.JSONB,
    allowNull: true,
  })
  externalData!: TransactionsAttributes['externalData'];

  @MoneyField({ storage: 'cents' })
  declare commissionRate: Money;

  @MoneyField({ storage: 'cents' })
  declare refCommissionRate: Money;

  @MoneyField({ storage: 'cents' })
  declare cashbackAmount: Money;

  // Metadata only: no balance, statistics or budget path reads these. What the user spent in a
  // foreign currency, with its ISO 4217 code. Both hold a value or both stay null.
  @MoneyField({ storage: 'cents', allowNull: true })
  declare originalAmount: Money | null;

  @ForeignKey(() => Currencies)
  @Column({ allowNull: true, defaultValue: null, type: DataType.STRING(3) })
  originalCurrencyCode!: string | null;

  // Represents if the transaction refunds another tx, or is being refunded by other. Added only for
  // optimization purposes. All the related refund information is tored in the "RefundTransactions"
  // table
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  refundLinked!: boolean;

  // `defaultValue` is required here, not just in SQL: backup restore rejects an archive that
  // omits a NOT NULL column unless the model supplies a default.
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isPlanned: boolean;

  // Metadata about how this transaction was categorized (manual, ai, mcc_rule, user_rule, subscription_rule, payee_rule)
  @Column({
    type: DataType.JSONB,
    allowNull: true,
  })
  categorizationMeta!: CategorizationMeta | null;

  @ForeignKey(() => Payees)
  @Column({ allowNull: true, type: DataType.UUID })
  payeeId!: RecordId | null;

  @BelongsTo(() => Payees)
  payee!: Payees;

  // True when the user explicitly assigned or cleared payeeId; both the inline
  // sync-time extraction and the post-sync note fuzzy backfill skip rows with
  // this flag set so manual overrides survive resyncs.
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  payeeLocked!: boolean;

  @Column({ allowNull: true, type: DataType.UUID })
  mergedIntoId!: RecordId | null;

  // Managed by Sequelize (timestamps: true)
  declare createdAt: Date;
  declare updatedAt: Date;
  declare deletedAt: Date | null;

  @BeforeCreate
  @BeforeUpdate
  static validateTransferRelatedFields(instance: Transactions) {
    const { transferNature, transferId, refAmount, refCurrencyCode } = instance;

    switch (transferNature) {
      case TRANSACTION_TRANSFER_NATURE.common_transfer:
      case TRANSACTION_TRANSFER_NATURE.transfer_to_loan: {
        // Loan payments are two-leg transfers between user-owned Accounts, so they
        // need the same paired-row fields as common_transfer; the distinct nature
        // exists only so reporting can isolate loan payments without an account join.
        const requiredFields = [transferId, refCurrencyCode, refAmount];
        if (requiredFields.some((item) => item === undefined)) {
          throw new ValidationError({
            message: `All these fields should be passed (${requiredFields}) for transfer transaction.`,
          });
        }
        return;
      }
      case TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio:
      case TRANSACTION_TRANSFER_NATURE.transfer_to_venture: {
        // Single-leg transfer: no paired transferId, but ref fields must still be set so
        // downstream aggregations can find the row. `refAmount == null` matches both null
        // and undefined returned by the Money getter when the underlying cents are null.
        if (!refCurrencyCode || refAmount == null) {
          throw new ValidationError({
            message: t({ key: 'transactions.refFieldsRequiredForTransferToPortfolio' }),
          });
        }
        return;
      }
      case TRANSACTION_TRANSFER_NATURE.not_transfer:
      case TRANSACTION_TRANSFER_NATURE.transfer_out_wallet:
        return;
      default: {
        // oxlint-disable-next-line no-underscore-dangle
        const _exhaustiveCheck: never = transferNature;
        throw new Error(`Unhandled transferNature in validateTransferRelatedFields: ${_exhaustiveCheck}`);
      }
    }
  }

  /**
   * Vehicle-account write invariant — enforced at the lowest funnel every
   * transaction write passes through.
   *
   * A vehicle is a regular `Accounts` row (accountCategory: 'vehicle') whose
   * balance is owned by the lazy-depreciation model plus manual overrides. Its
   * value may ONLY change through the override flow, which records a
   * `transfer_out_wallet` row AND keeps `Vehicle.valueAnchor` in sync. Any other
   * transaction (income/expense, transfers in or out, transfer-to-portfolio or
   * -venture) would move `Account.currentBalance` without touching the anchor —
   * so the next lazy refresh recomputes from the stale anchor and silently
   * discards the change. That is data loss, not just a confusing UI state.
   *
   * Rejecting every nature except `transfer_out_wallet` here covers every path
   * that creates or moves a transaction row: the manage-transaction UI, MCP
   * tools, bank sync, CSV import, direct API calls and any future endpoint all
   * funnel through this model. The legit override path passes for free — it IS a
   * `transfer_out_wallet`. (Note: a vehicle's `currentBalance` can also move
   * WITHOUT a transaction row — via `accountsService.updateAccount` — so that
   * path is guarded separately in the service; this hook is not the whole story.)
   */
  @BeforeCreate
  @BeforeUpdate
  static async enforceVehicleAccountInvariant(instance: Transactions) {
    // `transfer_out_wallet` is the only nature ever valid on a vehicle account,
    // so short-circuit before the account lookup. The lookup still runs for
    // every other write (most income/expense/transfer rows) — it's a narrow
    // single-column PK read, and only the override/adjustment rows skip it.
    if (instance.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet) return;

    const account = await Accounts.findByPk(instance.accountId, {
      attributes: ['accountCategory'],
    });
    // A missing account isn't a vehicle (FK / other validation rejects orphan
    // rows); only vehicle accounts are locked down here.
    if (account?.accountCategory !== ACCOUNT_CATEGORIES.vehicle) return;

    throw new ValidationError({
      message: t({ key: 'transactions.vehicleAccountReadonly' }),
    });
  }

  /**
   * Loan-account write invariant. A managed loan (accountCategory 'loan' with a
   * `LoanDetails` sidecar) accepts exactly one write: the INCOME leg of a
   * `transfer_to_loan` payment, already overpay-checked by
   * `assertLoanPaymentAllowed`. Anything else would move the balance while
   * staying invisible to `recomputeLoanBalance` (which sums only income legs),
   * corrupting the payoff projection. Loan-category accounts WITHOUT a sidecar
   * stay unrestricted. Enforced at the model so every write path (UI, MCP,
   * bank sync, CSV import, direct API) funnels through it.
   */
  @BeforeCreate
  @BeforeUpdate
  static async enforceLoanAccountInvariant(instance: Transactions) {
    // Only the income leg short-circuits. The expense-side leg of the same pair
    // must NOT: it belongs on the cash account, and landing on the loan account
    // would move the balance invisibly to the recompute (income legs only).
    if (
      instance.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan &&
      instance.transactionType === TRANSACTION_TYPES.income
    ) {
      return;
    }

    const account = await Accounts.findByPk(instance.accountId, {
      attributes: ['accountCategory'],
    });
    // Orphan accountIds are rejected by FK validation; only loans are locked down here.
    if (account?.accountCategory !== ACCOUNT_CATEGORIES.loan) return;

    // Enforcement applies only to managed loans; the sidecar lookup runs solely
    // for loan-category accounts, keeping it off the hot path of ordinary writes.
    const loanDetails = await LoanDetails.findOne({
      where: { accountId: instance.accountId },
      attributes: ['id'],
    });
    if (!loanDetails) return;

    throw new ValidationError({
      message: t({ key: 'transactions.loanAccountReadonly' }),
    });
  }

  // Lazy-imported to avoid a model→service import cycle (same approach as the
  // vehicle anchor reconcile hook). recomputeLoanBalance no-ops for non-loan
  // accounts, so callers only need the cheap transfer-nature gate.
  private static async triggerLoanBalanceRecompute(accountId: string): Promise<void> {
    const { recomputeLoanBalance } = await import('@services/loans/recompute-loan-balance.service');
    await recomputeLoanBalance({ loanAccountId: accountId });
  }

  @AfterCreate
  static async updateAccountBalanceAfterCreate(instance: Transactions) {
    const { accountType, accountId, amount, transactionType } = instance;

    // A planned row records money that hasn't moved yet.
    if (instance.isPlanned) return;

    if (accountType === ACCOUNT_TYPES.system) {
      await updateAccountBalanceForChangedTx({
        accountId,
        amount,
        transactionType,
      });
    }

    await Balances.handleTransactionChange({ data: instance });
    // Gate on the nature to keep the recompute off the non-loan hot path.
    if (instance.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan) {
      await Transactions.triggerLoanBalanceRecompute(instance.accountId);
    }
  }

  /**
   * Balance effect of an `isPlanned` flip: becoming real applies the amount exactly as
   * `@AfterCreate` does, going back to planned withdraws it exactly as `@BeforeDestroy`
   * does. The reverse works off `prevData` — the money sat on the pre-update account.
   */
  private static async applyPlannedFlipBalanceChange({
    newData,
    prevData,
    becameReal,
  }: {
    newData: Transactions;
    prevData: Transactions;
    becameReal: boolean;
  }): Promise<void> {
    if (becameReal) {
      if (newData.accountType === ACCOUNT_TYPES.system) {
        await updateAccountBalanceForChangedTx({
          accountId: newData.accountId,
          amount: newData.amount,
          transactionType: newData.transactionType,
        });
      }

      await Balances.handleTransactionChange({ data: newData });
      return;
    }

    if (prevData.accountType === ACCOUNT_TYPES.system) {
      await updateAccountBalanceForChangedTx({
        accountId: prevData.accountId,
        prevAmount: prevData.amount,
        transactionType: prevData.transactionType,
        // The row survives the flip, so the ledger-boundary lookup has to be told to
        // ignore it the same way a delete would.
        removedTransactionId: newData.id,
      });
    }

    await Balances.handleTransactionChange({ data: prevData, isDelete: true });
  }

  @AfterUpdate
  static async updateAccountBalanceAfterUpdate(instance: Transactions) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newData: Transactions = (instance as any).dataValues;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prevData: Transactions = (instance as any)._previousDataValues;

    // Must run while the money fields are still raw cents — the conversion below
    // replaces them with Money instances, which no longer compare by value.
    if (!hasBalanceRelevantChange({ next: newData, prev: prevData })) return;

    // dataValues/previousDataValues are raw DB values (cents integers), not Money.
    // Convert in-place so downstream code that expects Money objects works correctly.
    const MONEY_FIELDS = ['amount', 'refAmount', 'commissionRate', 'refCommissionRate', 'cashbackAmount'] as const;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newRaw = newData as any,
      prevRaw = prevData as any;
    for (const field of MONEY_FIELDS) {
      newRaw[field] = Money.fromCents(newRaw[field]);
      prevRaw[field] = Money.fromCents(prevRaw[field]);
    }

    const wasPlanned = Boolean(prevData.isPlanned);
    const isPlanned = Boolean(newData.isPlanned);

    if (wasPlanned !== isPlanned) {
      await Transactions.applyPlannedFlipBalanceChange({ newData, prevData, becameReal: wasPlanned });
      return;
    }

    // Editing a planned row moves nothing: the money still hasn't happened.
    if (isPlanned) return;

    const isAccountChanged = newData.accountId !== prevData.accountId;

    if (newData.accountType === ACCOUNT_TYPES.system) {
      if (isAccountChanged) {
        // Update old tx
        await updateAccountBalanceForChangedTx({
          accountId: prevData.accountId,
          prevAmount: prevData.amount,
          transactionType: prevData.transactionType,
        });

        // Update new tx
        await updateAccountBalanceForChangedTx({
          accountId: newData.accountId,
          amount: newData.amount,
          transactionType: newData.transactionType,
        });
      } else {
        await updateAccountBalanceForChangedTx({
          accountId: newData.accountId,
          amount: newData.amount,
          prevAmount: prevData.amount,
          transactionType: newData.transactionType,
          prevTransactionType: prevData.transactionType,
        });
      }
    }

    const originalData = {
      accountId: prevData.accountId,
      amount: prevData.amount,
      refAmount: prevData.refAmount,
      time: prevData.time,
      transactionType: prevData.transactionType,
      currencyCode: prevData.currencyCode,
    } as Transactions;

    await Balances.handleTransactionChange({
      data: newData,
      prevData: originalData,
    });

    // Either side of the edit may be a loan-transfer leg (amount/date edits, or
    // a leg moving onto/off a loan account). Non-loan edits skip entirely.
    if (
      newData.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan ||
      prevData.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan
    ) {
      await Transactions.triggerLoanBalanceRecompute(newData.accountId);
      if (newData.accountId !== prevData.accountId) {
        await Transactions.triggerLoanBalanceRecompute(prevData.accountId);
      }
    }
  }

  @BeforeDestroy
  static async updateAccountBalanceBeforeDestroy(instance: Transactions) {
    const { accountType, accountId, amount, transactionType } = instance;

    // Planned rows never moved a balance, so there is nothing to take back. Group
    // bookkeeping below still has to run so groups keep auto-dissolving.
    if (!instance.isPlanned) {
      if (accountType === ACCOUNT_TYPES.system) {
        await updateAccountBalanceForChangedTx({
          accountId,
          prevAmount: amount,
          transactionType,
          removedTransactionId: instance.id,
        });
      }

      await Balances.handleTransactionChange({ data: instance, isDelete: true });
    }

    // Capture group membership BEFORE CASCADE deletes the join rows.
    // Stored on the instance so @AfterDestroy can check only the affected groups.
    const groupItems = await TransactionGroupItems.findAll({
      where: { transactionId: instance.id },
      attributes: ['groupId'],
      raw: true,
    });
    // oxlint-disable-next-line no-underscore-dangle
    (instance as unknown as Record<string, unknown>)._affectedGroupIds = groupItems.map((item) => item.groupId);
  }

  @AfterDestroy
  static async reconcileVehicleAnchorOnDelete(instance: Transactions) {
    // When a balance-adjustment ("transfer_out_wallet") tx on a vehicle account
    // is deleted, the user's manual override is being undone. Re-derive the
    // vehicle's depreciation anchor by walking the REMAINING overrides forward
    // from purchase. The cents-arithmetic Account.currentBalance decremented by
    // BeforeDestroy is not the right anchor value — once the override chain has
    // more than one entry, the prior override's post-tx value depends on the
    // curve between it and the deleted one, not on a flat subtraction.
    if (instance.transferNature !== TRANSACTION_TRANSFER_NATURE.transfer_out_wallet) return;

    const account = await Accounts.findByPk(instance.accountId);
    if (!account || account.accountCategory !== ACCOUNT_CATEGORIES.vehicle) return;

    // Lazy-imported to avoid circular dep (Vehicles model is in the same model layer).
    const { default: Vehicles } = await import('@models/vehicles.model');
    const vehicle = await Vehicles.findOne({ where: { accountId: instance.accountId } });
    if (!vehicle) return;

    const { reconstructVehicleAnchor } = await import('@services/vehicles/reconstruct-vehicle-anchor');
    const reconstructed = await reconstructVehicleAnchor({ vehicle });

    if (reconstructed.hasOverrides) {
      await vehicle.update({
        valueAnchor: reconstructed.value,
        valueAnchorDate: reconstructed.date,
        valueLastComputedAt: null,
      });
    } else {
      await vehicle.update({
        valueAnchor: null,
        valueAnchorDate: null,
        valueLastComputedAt: null,
      });
    }

    // Recompute synchronously so the response (and any immediate cache refetch)
    // reflects today's curve-derived value, not the BeforeDestroy intermediate.
    const { refreshVehicleValueIfStale } = await import('@services/vehicles/refresh-vehicle-value.service');
    await refreshVehicleValueIfStale({ vehicleId: vehicle.id, force: true });
  }

  @AfterDestroy
  static async recomputeLoanBalanceAfterDestroy(instance: Transactions) {
    // Runs after the row is gone so the deleted leg is excluded from the
    // post-anchor sum. Gated on the nature so non-loan deletes skip the lookup.
    if (instance.transferNature !== TRANSACTION_TRANSFER_NATURE.transfer_to_loan) return;
    await Transactions.triggerLoanBalanceRecompute(instance.accountId);
  }

  @AfterDestroy
  static async autoDissolveEmptyGroups(instance: Transactions) {
    // After CASCADE removes the join row, check only the groups this transaction belonged to.
    // oxlint-disable-next-line no-underscore-dangle
    const affectedGroupIds = (instance as unknown as Record<string, unknown>)._affectedGroupIds as string[] | undefined;

    if (!affectedGroupIds || affectedGroupIds.length === 0) return;

    await dissolveUndersizedGroups({ groupIds: affectedGroupIds });
  }
}

function buildTransferCondition(filter: FILTER_OPERATION | undefined): Record<string, unknown> | null {
  if (filter === FILTER_OPERATION.exclude) return { transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer };
  if (filter === FILTER_OPERATION.only)
    return { transferNature: { [Op.ne]: TRANSACTION_TRANSFER_NATURE.not_transfer } };
  return null;
}

/**
 * Builds the ORDER BY clause for `findWithFilters`. Name-based sorts resolve the
 * related record's name via a correlated subquery instead of a JOIN so the result
 * shape stays identical regardless of sort field. `NULLS LAST` keeps rows without
 * the related record (e.g. no payee assigned) at the bottom in both directions.
 * `time` + `id` act as stable tie-breakers so pagination never duplicates rows.
 */
export function buildOrderClause({
  sortBy,
  order,
}: {
  sortBy: TRANSACTION_SORT_FIELD | undefined;
  order: SORT_DIRECTIONS;
}): Order {
  if (!sortBy || sortBy === TRANSACTION_SORT_FIELD.time) {
    return [
      ['time', order],
      ['id', order],
    ];
  }

  const sortExpressions: Record<Exclude<TRANSACTION_SORT_FIELD, TRANSACTION_SORT_FIELD.time>, string> = {
    [TRANSACTION_SORT_FIELD.refAmount]: '"Transactions"."refAmount"',
    [TRANSACTION_SORT_FIELD.accountName]:
      '(SELECT "name" FROM "Accounts" WHERE "Accounts"."id" = "Transactions"."accountId")',
    [TRANSACTION_SORT_FIELD.categoryName]:
      '(SELECT "name" FROM "Categories" WHERE "Categories"."id" = "Transactions"."categoryId")',
    [TRANSACTION_SORT_FIELD.payeeName]: '(SELECT "name" FROM "Payees" WHERE "Payees"."id" = "Transactions"."payeeId")',
    // NULLIF: notes saved as an empty string must land with the NULL ones, not first.
    [TRANSACTION_SORT_FIELD.note]: `NULLIF("Transactions"."note", '')`,
    [TRANSACTION_SORT_FIELD.categorizationSource]: `("Transactions"."categorizationMeta"->>'source')`,
  };

  // `order` is a validated SORT_DIRECTIONS enum value ('ASC'/'DESC') — safe to interpolate.
  return [
    literal(`${sortExpressions[sortBy]} ${order} NULLS LAST`),
    ['time', SORT_DIRECTIONS.desc],
    ['id', SORT_DIRECTIONS.desc],
  ];
}

function buildRefundCondition(filter: FILTER_OPERATION | undefined): Record<string, unknown> | null {
  if (filter === FILTER_OPERATION.exclude) return { refundLinked: false };
  if (filter === FILTER_OPERATION.only) return { refundLinked: true };
  return null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `refundLinked` can't express this filter: it is true for BOTH sides of a link, while
// only the refund side is barred from being linked again.
function buildExcludeRefundTxsCondition({ keepRefundsForTxId }: { keepRefundsForTxId?: string }) {
  if (keepRefundsForTxId && !UUID_PATTERN.test(keepRefundsForTxId)) {
    throw new ValidationError({ message: '"keepRefundsForTxId" must be a valid record id' });
  }
  // IS DISTINCT FROM: links with a null originalTxId (out-of-system originals) must stay excluded.
  const keepClause = keepRefundsForTxId ? ` AND rt."originalTxId" IS DISTINCT FROM '${keepRefundsForTxId}'` : '';
  return literal(
    `NOT EXISTS (SELECT 1 FROM "RefundTransactions" rt WHERE rt."refundTxId" = "Transactions"."id"${keepClause})`,
  );
}

const HAS_ATTACHMENTS_SQL = `EXISTS (SELECT 1 FROM "TransactionAttachments" ta WHERE ta."transactionId" = "Transactions"."id")`;

export const findWithFilters = async ({
  planned,
  access,
  completeness,
  balanceAdjustments,
  excludedAccounts = 'include',
  accountType,
  accountIds,
  excludeAccountIds,
  budgetIds,
  excludedBudgetIds,
  tagIds: requestedTagIds,
  excludedTagIds,
  order = SORT_DIRECTIONS.desc,
  sortBy,
  transferNatures,
  transactionType,
  includeSplits,
  includeTags,
  includeGroups,
  isRaw = false,
  excludeTransfer,
  excludeRefunds,
  excludeRefundTxs,
  keepRefundsForTxId,
  hasAttachment,
  includeHasAttachments,
  transferFilter,
  refundFilter,
  startDate,
  endDate,
  amountGte,
  amountLte,
  refAmountGte,
  refAmountLte,
  categoryIds,
  payeeIds,
  noteSearch,
  attributes,
  categorizationSource,
  categorizedAt,
  batchId,
}: {
  /** How planned rows are treated. `{ visibleTo }` keeps other users' plans out while leaving the caller's own visible. */
  planned: PlannedPolicy;
  /** Row-visibility scope; `'pre-scoped'` when the caller narrowed the rows upstream. */
  access: WhereAccessPolicy;
  /** Result completeness. No default: every caller states whether it needs the full set. */
  completeness: CompletenessPolicy;
  /** Whether balance-adjustment rows (`externalData.balanceAdjustment`) count. No default. */
  balanceAdjustments: BalanceAdjustmentsPolicy;
  /** `'exclude'` INNER JOINs Accounts to drop rows on accounts flagged `excludeFromStats`. */
  excludedAccounts?: ExcludedAccountsPolicy;
  accountType?: ACCOUNT_TYPES;
  transactionType?: TRANSACTION_TYPES;
  accountIds?: string[];
  /** Filter: exclude transactions from these account IDs */
  excludeAccountIds?: string[];
  budgetIds?: string[];
  excludedBudgetIds?: string[];
  tagIds?: string[];
  excludedTagIds?: string[];
  order?: SORT_DIRECTIONS;
  /** Sort field; defaults to `time`. Name-based fields sort via correlated subqueries. */
  sortBy?: TRANSACTION_SORT_FIELD;
  /**
   * Exact set of transfer natures to include (e.g. `not_transfer` + selected transfer
   * kinds). When present, supersedes `transferFilter`/`excludeTransfer` — the caller
   * fully describes which natures it wants.
   */
  transferNatures?: TRANSACTION_TRANSFER_NATURE[];
  includeSplits?: boolean;
  includeTags?: boolean;
  includeGroups?: boolean;
  isRaw?: boolean;
  excludeTransfer?: boolean;
  excludeRefunds?: boolean;
  /** Excludes the refund side of refund links — those rows can never be linked again.
   *  Originals that merely HAVE refunds stay (partial refunds are allowed). */
  excludeRefundTxs?: boolean;
  /** With `excludeRefundTxs`: keep refunds linked to this original, so an edit dialog
   *  can still list and deselect its own links. */
  keepRefundsForTxId?: string;
  /** Absent = both, `true` = only rows carrying attachments, `false` = only rows without. */
  hasAttachment?: boolean;
  /** Adds a `hasAttachments` boolean to every row. Costs an EXISTS subquery per row, so
   *  only the user-facing list asks for it. */
  includeHasAttachments?: boolean;
  transferFilter?: FILTER_OPERATION;
  refundFilter?: FILTER_OPERATION;
  startDate?: string;
  endDate?: string;
  /** Filter: amount >= this value */
  amountGte?: Money;
  /** Filter: amount <= this value */
  amountLte?: Money;
  /** Filter: refAmount >= this value - for cross-currency matching */
  refAmountGte?: Money;
  /** Filter: refAmount <= this value - for cross-currency matching */
  refAmountLte?: Money;
  categoryIds?: string[];
  payeeIds?: string[];
  noteSearch?: string[]; // array of keywords
  attributes?: (keyof Transactions)[];
  categorizationSource?: CATEGORIZATION_SOURCE;
  /** Exact `categorizationMeta.categorizedAt` stamp, which identifies one categorization run. */
  categorizedAt?: string;
  /** Filter to only transactions from one import batch (`externalData.importDetails.batchId`). */
  batchId?: string;
}) => {
  const cap = capPolicy({ completeness });
  // Created before the first await so the stack still holds the frames of the site that
  // set the cap; only read when the result comes back full.
  const truncationProbe = cap ? new Error() : null;

  const queryInclude: Includeable[] = prepareTXInclude({ includeSplits });

  if (excludedAccounts === 'exclude') {
    queryInclude.push({ model: Accounts, where: { excludeFromStats: false }, attributes: [], required: true });
  }

  // New enum params take priority over legacy booleans
  const resolvedTransferFilter = transferFilter ?? (excludeTransfer ? FILTER_OPERATION.exclude : undefined);
  const resolvedRefundFilter = refundFilter ?? (excludeRefunds ? FILTER_OPERATION.exclude : undefined);

  // An explicit nature list fully describes which transferNature values to include,
  // so it replaces the coarse all/exclude/only condition.
  const transferCondition = transferNatures?.length
    ? { transferNature: { [Op.in]: transferNatures } }
    : buildTransferCondition(resolvedTransferFilter);
  const refundCondition = buildRefundCondition(resolvedRefundFilter);

  const whereClause: WhereOptions<Transactions> = {
    ...(access === 'pre-scoped' ? {} : { userId: access.creator }),
    ...removeUndefinedKeys({
      accountType,
      transactionType,
    }),
  };

  const pushAndCondition = (condition: WhereOptions<Transactions>) => {
    const andConditions = (whereClause[Op.and as unknown as string] as unknown[] | undefined) ?? [];
    andConditions.push(condition);
    whereClause[Op.and as unknown as string] = andConditions;
  };

  // When both filters are "only", use OR logic so the user can see
  // "refunds OR transfers" instead of the impossible "refunds AND transfers"
  if (
    transferCondition &&
    refundCondition &&
    resolvedTransferFilter === FILTER_OPERATION.only &&
    resolvedRefundFilter === FILTER_OPERATION.only
  ) {
    // Wrap in Op.and to avoid conflicting with category filter's Op.or
    pushAndCondition({ [Op.or]: [transferCondition, refundCondition] });
  } else {
    if (transferCondition) Object.assign(whereClause, transferCondition);
    if (refundCondition) Object.assign(whereClause, refundCondition);
  }

  if (excludeRefundTxs) {
    pushAndCondition(buildExcludeRefundTxsCondition({ keepRefundsForTxId }));
  }

  if (hasAttachment !== undefined) {
    pushAndCondition(literal(`${hasAttachment ? '' : 'NOT '}${HAS_ATTACHMENTS_SQL}`));
  }

  if (categoryIds && categoryIds.length > 0) {
    // Find transactions that have splits with any of the requested category IDs.
    // Under `access: 'pre-scoped'` we widen the lookup to any user's splits — the caller's
    // upstream scoping (accessible accountIds / budget ids) constrains the final rows, so
    // this stays safe.
    const splitsWhere: Record<string, unknown> = { categoryId: { [Op.in]: categoryIds } };
    if (access !== 'pre-scoped') splitsWhere.userId = access.creator;
    const transactionIdsWithMatchingSplits = await TransactionSplits.findAll({
      attributes: ['transactionId'],
      where: splitsWhere,
      raw: true,
    }).then((results) => [...new Set(results.map((r) => r.transactionId))]);

    if (transactionIdsWithMatchingSplits.length > 0) {
      // Include transactions where primary category matches OR has splits with matching category
      whereClause[Op.or as unknown as string] = [
        { categoryId: { [Op.in]: categoryIds } },
        { id: { [Op.in]: transactionIdsWithMatchingSplits } },
      ];
    } else {
      // No splits match, just filter by primary categoryId
      whereClause.categoryId = {
        [Op.in]: categoryIds,
      };
    }
  }

  if (payeeIds && payeeIds.length > 0) {
    const realPayeeIds = payeeIds.filter((id) => id !== BLANK_FILTER_VALUE);
    if (realPayeeIds.length === payeeIds.length) {
      whereClause.payeeId = { [Op.in]: realPayeeIds };
    } else {
      pushAndCondition({
        [Op.or]: [{ payeeId: null }, ...(realPayeeIds.length ? [{ payeeId: { [Op.in]: realPayeeIds } }] : [])],
      });
    }
  }

  if (accountIds && accountIds.length > 0) {
    whereClause.accountId = {
      [Op.in]: accountIds,
    };
  }

  if (excludeAccountIds && excludeAccountIds.length > 0) {
    whereClause.accountId = {
      ...(whereClause.accountId as object | undefined),
      [Op.notIn]: excludeAccountIds,
    };
  }

  if (startDate || endDate) {
    whereClause.time = {};
    if (startDate && endDate) {
      whereClause.time = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    } else if (startDate) {
      whereClause.time[Op.gte] = new Date(startDate);
    } else if (endDate) {
      whereClause.time[Op.lte] = new Date(endDate);
    }
  }

  if (amountGte || amountLte) {
    whereClause.amount = {};
    if (amountGte && amountLte) {
      whereClause.amount = {
        [Op.between]: [amountGte.toCents(), amountLte.toCents()],
      };
    } else if (amountGte) {
      whereClause.amount[Op.gte] = amountGte.toCents();
    } else if (amountLte) {
      whereClause.amount[Op.lte] = amountLte.toCents();
    }
  }

  if (refAmountGte || refAmountLte) {
    whereClause.refAmount = {};
    if (refAmountGte && refAmountLte) {
      whereClause.refAmount = {
        [Op.between]: [refAmountGte.toCents(), refAmountLte.toCents()],
      };
    } else if (refAmountGte) {
      whereClause.refAmount[Op.gte] = refAmountGte.toCents();
    } else if (refAmountLte) {
      whereClause.refAmount[Op.lte] = refAmountLte.toCents();
    }
  }

  if (budgetIds?.length) {
    const budgetTransactionIds = await BudgetTransactions.findAll({
      attributes: ['transactionId'],
      where: {
        budgetId: { [Op.in]: budgetIds },
      },
      raw: true,
    }).then((results) => results.map((r) => r.transactionId));

    whereClause.id = {
      ...(whereClause.id as object),
      [Op.in]: budgetTransactionIds,
    };
  }

  if (excludedBudgetIds?.length) {
    const excludedTransactionIds = await BudgetTransactions.findAll({
      attributes: ['transactionId'],
      where: {
        budgetId: {
          [Op.in]: excludedBudgetIds,
        },
      },
      raw: true,
    }).then((results) => results.map((r) => r.transactionId));

    if (excludedTransactionIds.length > 0) {
      whereClause.id = {
        ...(whereClause.id as object),
        [Op.notIn]: excludedTransactionIds,
      };
    }
  }

  const hasBlankTag = !!requestedTagIds?.includes(BLANK_FILTER_VALUE);
  const tagIds = hasBlankTag ? requestedTagIds!.filter((id) => id !== BLANK_FILTER_VALUE) : requestedTagIds;
  // A required include can't express "no tags", so the blank case is a correlated subquery.
  if (hasBlankTag) {
    if (tagIds!.some((id) => !UUID_PATTERN.test(id))) {
      throw new ValidationError({ message: '"tagIds" must contain valid record ids' });
    }
    const junction = `SELECT 1 FROM "TransactionTags" tt WHERE tt."transactionId" = "Transactions"."id"`;
    const untagged = `NOT EXISTS (${junction})`;
    const taggedWithAny = `EXISTS (${junction} AND tt."tagId" IN (${tagIds!.map((id) => `'${id}'`).join(', ')}))`;
    pushAndCondition(literal(tagIds!.length ? `(${untagged} OR ${taggedWithAny})` : untagged));
  }

  // Filter by tagIds - include only transactions with these tags
  if (tagIds?.length && !hasBlankTag) {
    queryInclude.push({
      model: Tags,
      through: { attributes: [], where: { tagId: { [Op.in]: tagIds } } },
      attributes: [],
      required: true,
    });
  }

  // Exclude transactions with specific tags
  if (excludedTagIds?.length) {
    const excludedTransactionIds = await TransactionTags.findAll({
      attributes: ['transactionId'],
      where: {
        tagId: {
          [Op.in]: excludedTagIds,
        },
      },
      raw: true,
    }).then((results) => results.map((r) => r.transactionId));

    if (excludedTransactionIds.length > 0) {
      // Merge with existing id exclusions if any
      if (whereClause.id && (whereClause.id as Record<symbol, string[]>)[Op.notIn]) {
        const existingExclusions = (whereClause.id as Record<symbol, string[]>)[Op.notIn] as string[];
        whereClause.id = {
          ...(whereClause.id as object),
          [Op.notIn]: [...new Set([...existingExclusions, ...excludedTransactionIds])],
        };
      } else {
        whereClause.id = {
          ...(whereClause.id as object),
          [Op.notIn]: excludedTransactionIds,
        };
      }
    }
  }

  // Include tags in response if requested
  // Note: when filtering by tagIds, we add a separate non-required include to get all tags
  if (includeTags) {
    // Remove any existing Tags include from tagIds filtering (which was required: true)
    const tagFilterIndex = queryInclude.findIndex((inc) => (inc as { model?: unknown }).model === Tags);
    if (tagFilterIndex !== -1) {
      queryInclude.splice(tagFilterIndex, 1);
    }

    // Add tags include for display (with filtering if tagIds provided)
    queryInclude.push({
      model: Tags,
      through: {
        attributes: [],
        ...(tagIds?.length ? { where: { tagId: { [Op.in]: tagIds } } } : {}),
      },
      attributes: ['id', 'name', 'color', 'icon'],
      required: !!tagIds?.length && !hasBlankTag,
    });
  }

  // Add note search condition if provided
  if (noteSearch && noteSearch.length > 0) {
    whereClause.note = {
      [Op.or]: noteSearch.map((term) => ({
        [Op.iLike]: `%${term}%`,
      })),
    };
  }

  // Include group membership info if requested. transactionCount is the group's full
  // membership size (a correlated count over TransactionGroupItems), not the number of
  // this group's members that happen to be in the current fetch window – so callers that
  // only load a slice of transactions (e.g. the dashboard widget) can still show the
  // group's true size.
  if (includeGroups) {
    queryInclude.push({
      model: TransactionGroups,
      through: { attributes: [] },
      attributes: [
        'id',
        'name',
        [
          literal(`(
            SELECT COUNT(*)::int
            FROM "TransactionGroupItems"
            WHERE "TransactionGroupItems"."groupId" = "transactionGroups"."id"
          )`),
          'transactionCount',
        ],
      ],
      required: false,
    });
  }

  // Op.and, never a bare key: the policy clauses must not collide with (or be clobbered
  // by) the caller's own keys and Op.or branches built above.
  for (const fragment of [plannedWhere({ policy: planned }), balanceAdjustmentsWhere({ policy: balanceAdjustments })]) {
    if (isEmptyFragment(fragment)) continue;

    const existingAnd = whereClause[Op.and as unknown as string] as unknown[] | undefined;
    whereClause[Op.and as unknown as string] = existingAnd ? [...existingAnd, fragment] : [fragment];
  }

  // Filter by categorization source (stored in JSONB field)
  if (categorizationSource) {
    whereClause['categorizationMeta.source'] = categorizationSource;
  }

  if (categorizedAt) {
    whereClause['categorizationMeta.categorizedAt'] = categorizedAt;
  }

  if (batchId) {
    // Must match the index expression in migration
    // 20251229000000-add-index-external-data-import-details exactly
    // (`"externalData"->'importDetails'->>'batchId'`) - Sequelize's dotted-key
    // shorthand compiles to `#>>` instead and would skip the index.
    const batchIdMatch = sequelizeWhere(literal(`"Transactions"."externalData"->'importDetails'->>'batchId'`), batchId);
    const existingAnd = whereClause[Op.and as unknown as string] as unknown[] | undefined;
    whereClause[Op.and as unknown as string] = existingAnd ? [...existingAnd, batchIdMatch] : [batchIdMatch];
  }
  const { limit, offset } = completenessToPagination({ completeness });

  const hasAttachmentsAttribute: ProjectionAlias = [literal(HAS_ATTACHMENTS_SQL), 'hasAttachments'];
  const resolvedAttributes: FindAttributeOptions | undefined = !includeHasAttachments
    ? attributes
    : attributes
      ? [...attributes, hasAttachmentsAttribute]
      : { include: [hasAttachmentsAttribute] };

  const transactions = await Transactions.findAll({
    include: queryInclude,
    where: whereClause,
    offset,
    limit,
    order: buildOrderClause({ sortBy, order }),
    raw: isRaw,
    // When raw is true and includeSplits/includeTags is requested, use nest to preserve nested structure
    nest: isRaw && (includeSplits || includeTags) ? true : undefined,
    attributes: resolvedAttributes,
  });

  // `info`, not `warn`: warn ships every occurrence to Sentry as its own event.
  if (cap && truncationProbe && cap.onTruncated === 'log' && transactions.length === cap.limit) {
    logger.info(`[findWithFilters] read hit its cap of ${cap.limit} rows, the result is likely truncated`, {
      cap: cap.limit,
      caller: callerFrame({ probe: truncationProbe, ignoreFile: __filename }),
      ...cap.context,
    });
  }

  return transactions;
};

export const getTransactionById = ({
  id,
  userId,
  includeSplits,
  includeTags,
}: {
  id: string;
  userId: number;
  includeSplits?: boolean;
  includeTags?: boolean;
}): Promise<Transactions | null> => {
  const include = prepareTXInclude({ includeSplits, includeTags });

  return Transactions.findOne({
    where: { id, userId },
    include,
  });
};

export const getTransactionsByTransferId = ({
  transferId,
  accountIds,
}: {
  transferId: string;
  accountIds: string[];
}) => {
  if (accountIds.length === 0) return Promise.resolve([] as Transactions[]);
  return Transactions.findAll({
    where: { transferId, accountId: { [Op.in]: accountIds } },
  });
};

export const getTransactionsByArrayOfField = async <T extends keyof TransactionModel>({
  fieldValues,
  fieldName,
  userId,
}: {
  fieldValues: TransactionModel[T][];
  fieldName: T;
  userId: number;
}) => {
  return Transactions.findAll({
    where: {
      [fieldName]: {
        [Op.in]: fieldValues,
      },
      userId,
    },
  });
};

type CreateTxRequiredParams = Pick<
  TransactionsAttributes,
  | 'amount'
  | 'refAmount'
  | 'userId'
  | 'transactionType'
  | 'paymentType'
  | 'accountId'
  | 'currencyCode'
  | 'accountType'
  | 'transferNature'
>;
type CreateTxOptionalParams = Partial<
  Pick<
    TransactionsAttributes,
    | 'note'
    | 'externalUrl'
    | 'externalReference'
    | 'location'
    | 'time'
    | 'categoryId'
    | 'refCurrencyCode'
    | 'transferId'
    | 'originalId'
    | 'externalData'
    | 'commissionRate'
    | 'refCommissionRate'
    | 'cashbackAmount'
    | 'categorizationMeta'
    | 'payeeId'
    | 'payeeLocked'
    | 'isPlanned'
    | 'originalAmount'
    | 'originalCurrencyCode'
  >
>;

export type CreateTransactionPayload = CreateTxRequiredParams & CreateTxOptionalParams;

export const createTransaction = async ({ userId, ...rest }: CreateTransactionPayload) => {
  const response = await Transactions.create({ userId, ...rest });

  return getTransactionById({
    id: response.get('id'),
    userId,
  });
};

export interface UpdateTransactionByIdParams {
  id: string;
  userId: number;
  amount?: Money;
  refAmount?: Money;
  note?: string | null;
  externalUrl?: string | null;
  externalReference?: string | null;
  location?: TransactionLocation | null;
  time?: Date;
  transactionType?: TRANSACTION_TYPES;
  paymentType?: PAYMENT_TYPES;
  accountId?: string;
  categoryId?: string;
  /** Moving a row between accounts moves it between account types; the hooks read this one. */
  accountType?: ACCOUNT_TYPES;
  currencyCode?: string;
  refCurrencyCode?: string;
  transferNature?: TRANSACTION_TRANSFER_NATURE;
  transferId?: string | null;
  refundLinked?: boolean;
  categorizationMeta?: CategorizationMeta | null;
  payeeId?: string | null;
  payeeLocked?: boolean;
  isPlanned?: boolean;
  originalAmount?: Money | null;
  originalCurrencyCode?: string | null;
}

export const updateTransactionById = async (
  { id, userId, ...payload }: UpdateTransactionByIdParams,
  {
    // For refunds we need to have an option to disable them. Otherwise there will be some kind of
    // deadlock - request stucks forever with no error message. TODO: consider removing this logic at all
    individualHooks = true,
  }: { individualHooks?: boolean } = {},
) => {
  const where = { id, userId };

  await Transactions.update(removeUndefinedKeys(payload), {
    where,
    individualHooks,
  });

  // Return transactions exactly like that. Ading `returning: true` causes balances not being updated
  return getTransactionById({ id, userId }) as Promise<Transactions>;
};

export const updateTransactions = (
  payload: {
    amount?: Money;
    note?: string;
    time?: Date;
    transactionType?: TRANSACTION_TYPES;
    paymentType?: PAYMENT_TYPES;
    accountId?: string;
    categoryId?: string;
    accountType?: ACCOUNT_TYPES;
    currencyCode?: string;
    refCurrencyCode?: string;
    refundLinked?: boolean;
    payeeId?: string | null;
    payeeLocked?: boolean;
    categorizationMeta?: CategorizationMeta | null;
  },
  where: Record<string, unknown> & { userId: number },
  {
    // For refunds we need to have an option to disable them. Otherwise there will be some kind of
    // deadlock - request stucks forever with no error message. TODO: consider removing this logic at all
    individualHooks = true,
  }: { individualHooks?: boolean } = {},
) => {
  return Transactions.update(removeUndefinedKeys(payload), {
    where,
    individualHooks,
  });
};

export const deleteTransactionById = async ({ id, userId }: { id: string; userId: number }) => {
  const tx = await getTransactionById({ id, userId });

  if (!tx) return true;

  // A plan on a provider account is the user's own row that the bank has never reported,
  // so deleting it takes nothing away from the sync.
  if (tx.accountType !== ACCOUNT_TYPES.system && !tx.isPlanned) {
    throw new ValidationError({
      message: t({ key: 'transactions.cannotDeleteExternal' }),
    });
  }

  return Transactions.destroy({
    where: { id, userId },
    // So that BeforeDestroy will be triggered
    individualHooks: true,
    force: true,
  });
};
