/**
 * Every column and JSON field that holds a transactional money amount as `DECIMAL(36,18)`.
 * The backup v1 converter divides these by 100, the check script and the backup and restore
 * code read them, and a unit test keeps them in step with the model declarations. Add a new
 * money column here when its model declares it.
 *
 * The money-storage migration does not read this list: it has its own frozen snapshot in
 * `migrations/utils/money-columns-20261016.ts`, so a column added here never reaches it.
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
  { table: 'Balances', column: 'amount' },
  { table: 'BudgetAssignments', column: 'baselineAmount' },
  { table: 'BudgetAssignments', column: 'overrideAmount' },
  { table: 'BudgetLineGoals', column: 'amount' },
  { table: 'BudgetLineGoals', column: 'stopAtBalance' },
  { table: 'BudgetLineGoals', column: 'fundingCap' },
  { table: 'BudgetPlans', column: 'expectedIncome' },
  { table: 'Trackers', column: 'limitAmount' },
  { table: 'ImportBatchAccountEffects', column: 'absorbedAmount' },
  { table: 'LoanDetails', column: 'originalPrincipal' },
  { table: 'LoanDetails', column: 'refOriginalPrincipal' },
  { table: 'LoanDetails', column: 'minPayment' },
  { table: 'LoanDetails', column: 'refMinPayment' },
  { table: 'LoanDetails', column: 'plannedPayment' },
  { table: 'LoanDetails', column: 'refPlannedPayment' },
  { table: 'SubscriptionCandidates', column: 'averageAmount' },
  { table: 'Subscriptions', column: 'expectedAmount' },
  { table: 'TrackerLines', column: 'limitAmount' },
  { table: 'TransactionSplits', column: 'amount' },
  { table: 'TransactionSplits', column: 'refAmount' },
  { table: 'TransactionTemplates', column: 'amount' },
  { table: 'Transactions', column: 'amount' },
  { table: 'Transactions', column: 'refAmount' },
  { table: 'Transactions', column: 'commissionRate' },
  { table: 'Transactions', column: 'refCommissionRate' },
  { table: 'Transactions', column: 'cashbackAmount' },
  { table: 'Transactions', column: 'originalAmount' },
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
];
