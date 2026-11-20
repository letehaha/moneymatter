/**
 * Every column that holds a transactional money amount as `DECIMAL(36,18)`, and the JSON fields
 * that hold such amounts: the inventory of where money is stored today. A unit test checks the
 * columns both ways against the model declarations, so a new money column must be added here and
 * a renamed or dropped one changed or removed. `MONEY_COLUMN_PRECISION` and `MONEY_COLUMN_SCALE`
 * are the shape of those columns.
 *
 * Code that depends on a fixed point in history reads a frozen snapshot instead of this list: the
 * money-storage migration and the restore of format 1 to 3 backups both read
 * `migrations/utils/money-columns-20261115.ts`, the columns that held cents before that migration.
 */

export const MONEY_COLUMN_PRECISION = 36;
export const MONEY_COLUMN_SCALE = 18;

export interface MoneyColumnSpec {
  /** SQL table name. */
  table: string;
  /** SQL column name. */
  column: string;
}

export const MONEY_COLUMNS: readonly MoneyColumnSpec[] = [
  { table: 'Accounts', column: 'initialBalance' },
  { table: 'Accounts', column: 'refInitialBalance' },
  { table: 'Accounts', column: 'currentBalance' },
  { table: 'Accounts', column: 'refCurrentBalance' },
  { table: 'Accounts', column: 'creditLimit' },
  { table: 'Accounts', column: 'refCreditLimit' },
  { table: 'Accounts', column: 'seamBalance' },
  { table: 'Balances', column: 'amount' },
  { table: 'BudgetAssignments', column: 'baselineAmount' },
  { table: 'BudgetAssignments', column: 'overrideAmount' },
  { table: 'BudgetLineGoals', column: 'amount' },
  { table: 'BudgetLineGoals', column: 'stopAtBalance' },
  { table: 'BudgetLineGoals', column: 'fundingCap' },
  { table: 'BudgetPlans', column: 'expectedIncome' },
  { table: 'GoalAccounts', column: 'fixedAmount' },
  { table: 'Goals', column: 'targetAmount' },
  { table: 'Goals', column: 'plannedMonthly' },
  { table: 'Goals', column: 'achievedAmount' },
  { table: 'ImportBatchAccountEffects', column: 'absorbedAmount' },
  { table: 'LoanDetails', column: 'originalPrincipal' },
  { table: 'LoanDetails', column: 'refOriginalPrincipal' },
  { table: 'LoanDetails', column: 'minPayment' },
  { table: 'LoanDetails', column: 'refMinPayment' },
  { table: 'LoanDetails', column: 'plannedPayment' },
  { table: 'LoanDetails', column: 'refPlannedPayment' },
  { table: 'RefundTransactions', column: 'amount' },
  { table: 'SubscriptionCandidates', column: 'averageAmount' },
  { table: 'Subscriptions', column: 'expectedAmount' },
  { table: 'TrackerLines', column: 'limitAmount' },
  { table: 'Trackers', column: 'limitAmount' },
  { table: 'TransactionSplits', column: 'amount' },
  { table: 'TransactionSplits', column: 'refAmount' },
  { table: 'TransactionTemplates', column: 'amount' },
  { table: 'Transactions', column: 'amount' },
  { table: 'Transactions', column: 'refAmount' },
  { table: 'Transactions', column: 'commissionRate' },
  { table: 'Transactions', column: 'refCommissionRate' },
  { table: 'Transactions', column: 'cashbackAmount' },
  { table: 'Transactions', column: 'originalAmount' },
  { table: 'Transactions', column: 'paymentAmount' },
  { table: 'Vehicles', column: 'purchasePrice' },
  { table: 'Vehicles', column: 'valueAnchor' },
];

export interface MoneyJsonFieldSpec {
  /** SQL table name. */
  table: string;
  /** JSONB column. */
  column: string;
  /** `object`: the column is one JSON object. `array`: the column is an array of JSON objects. */
  shape: 'object' | 'array';
  /** For `object` only: object keys leading from the column to the object that holds the amounts. Empty means the column itself. */
  path?: readonly string[];
  /** Keys of the object (or of each array element) that hold an amount. */
  keys: readonly string[];
}

export const MONEY_JSON_FIELDS: readonly MoneyJsonFieldSpec[] = [
  {
    table: 'TagReminders',
    column: 'settings',
    shape: 'object',
    keys: ['amountThreshold'],
  },
  // Only `planned_payment_change` and `balance_correction` events carry amounts. The keys keep
  // their `fromCents`/`toCents` names, but the values are decimals.
  {
    table: 'LoanDetails',
    column: 'events',
    shape: 'array',
    keys: ['fromCents', 'toCents'],
  },
  // The state a linked transaction had before linking, kept so unlinking can restore it.
  {
    table: 'VentureEventLinks',
    column: 'metaData',
    shape: 'object',
    path: ['originalTransactionState'],
    keys: ['amount', 'refAmount'],
  },
  {
    table: 'PortfolioTransfers',
    column: 'metaData',
    shape: 'object',
    path: ['originalTransactionState'],
    keys: ['amount', 'refAmount'],
  },
  // The balances compared when an account was linked to a bank.
  {
    table: 'Accounts',
    column: 'externalData',
    shape: 'object',
    path: ['bankConnection', 'balanceReconciliation'],
    keys: ['systemBalance', 'externalBalance', 'difference', 'absorbedResidual'],
  },
];
