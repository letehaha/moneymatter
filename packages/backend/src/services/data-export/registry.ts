import { transformAccounts } from './transformers/accounts-transformer';
import { transformBalancesHistory } from './transformers/balances-history-transformer';
import { transformBudgets } from './transformers/budgets-transformer';
import { transformCategories } from './transformers/categories-transformer';
import { transformHoldings } from './transformers/holdings-transformer';
import { transformInvestmentTransactions } from './transformers/investment-transactions-transformer';
import { transformPayees } from './transformers/payees-transformer';
import { transformPortfolioTransfers } from './transformers/portfolio-transfers-transformer';
import { transformPortfolios } from './transformers/portfolios-transformer';
import { transformSubscriptions } from './transformers/subscriptions-transformer';
import { transformTags } from './transformers/tags-transformer';
import { transformTransactionTemplates } from './transformers/transaction-templates-transformer';
import { transformTransactions } from './transformers/transactions-transformer';
import { transformVehicles } from './transformers/vehicles-transformer';
import type { ExportBuildInput, ExportFileName, ExportGroup, ExportTable } from './types';

/**
 * Kind of cell content. The writer uses this to decide formatting:
 * - `money`: numeric, XLSX gets `0.00` format
 * - `number`: numeric, no format hint
 * - `boolean`: rendered as `true`/`false`
 * - `text`: passed through as-is
 * - `array`: joined with '; ' at the CSV/XLSX boundary; JSON keeps the array
 * - `date`: YYYY-MM-DD or ISO datetime string, passed through as-is
 */
export type ColumnKind = 'text' | 'money' | 'number' | 'boolean' | 'array' | 'date';

/**
 * Row payload for a given file name. `Extract` selects the matching arm of
 * the discriminated `ExportTable` union and pulls a single element type out
 * of its `rows` array – `RowOf<'transactions'>` resolves to `TransactionRow`.
 */
type RowOf<N extends ExportFileName> = Extract<ExportTable, { name: N }>['rows'][number];

export interface ColumnSpec {
  /** PascalCase header label visible in the CSV header row and XLSX top row. */
  readonly header: string;
  /** camelCase property on the transformer's row object. */
  readonly field: string;
  readonly kind: ColumnKind;
}

/** Registry-side narrowing: `field` must be a key of the entry's own row type. */
interface TypedColumnSpec<TRow> extends ColumnSpec {
  readonly field: keyof TRow & string;
}

/**
 * Per-entry narrow form. The generic `N` ties `name`, `build`'s return
 * type, and each `columns[].field` together: a copy-paste that wires
 * `transformTransactions` into `{ name: 'accounts', ... }` no longer
 * compiles, and a typo like `field: 'curency'` is rejected at registration
 * instead of silently emitting an empty column in every export.
 *
 * Abolished alternative: keeping the file-name union, group→files map,
 * column header table, money-column table, and builder dispatch as five
 * parallel registrations. Drifting one without the others silently broke a
 * downstream writer – the registry keeps all five derived from this one entry.
 */
interface ExportDomain<N extends ExportFileName> {
  readonly name: N;
  readonly group: ExportGroup;
  readonly columns: readonly TypedColumnSpec<RowOf<N>>[];
  readonly build: (input: ExportBuildInput) => Promise<RowOf<N>[]>;
}

/**
 * Keyed by file name so a missing or extra domain is a compile error. Key
 * order is output order: xlsx sheets and JSON sections follow it.
 */
export const EXPORT_DOMAINS: { readonly [N in ExportFileName]: ExportDomain<N> } = {
  transactions: {
    name: 'transactions',
    group: 'transactions',
    build: ({ userId, dateRange, accountIds }) => transformTransactions({ userId, dateRange, accountIds }),
    columns: [
      { header: 'Date', field: 'date', kind: 'date' },
      { header: 'Time', field: 'time', kind: 'text' },
      { header: 'Account', field: 'account', kind: 'text' },
      { header: 'Type', field: 'type', kind: 'text' },
      { header: 'PaymentType', field: 'paymentType', kind: 'text' },
      { header: 'Category', field: 'category', kind: 'text' },
      { header: 'Subcategory', field: 'subcategory', kind: 'text' },
      { header: 'Payee', field: 'payee', kind: 'text' },
      { header: 'Amount', field: 'amount', kind: 'money' },
      { header: 'Currency', field: 'currency', kind: 'text' },
      { header: 'AmountInBaseCurrency', field: 'amountInBaseCurrency', kind: 'money' },
      { header: 'BaseCurrency', field: 'baseCurrency', kind: 'text' },
      { header: 'Note', field: 'note', kind: 'text' },
      { header: 'ExternalUrl', field: 'externalUrl', kind: 'text' },
      { header: 'ExternalReference', field: 'externalReference', kind: 'text' },
      { header: 'Location', field: 'location', kind: 'text' },
      { header: 'Tags', field: 'tags', kind: 'array' },
      { header: 'SplitDetails', field: 'splitDetails', kind: 'text' },
      { header: 'RefundOf', field: 'refundOf', kind: 'text' },
      { header: 'LinkedTransfer', field: 'linkedTransfer', kind: 'text' },
      { header: 'Subscription', field: 'subscription', kind: 'text' },
      { header: 'Planned', field: 'isPlanned', kind: 'boolean' },
    ],
  },
  accounts: {
    name: 'accounts',
    group: 'transactions',
    build: ({ userId, accountIds }) => transformAccounts({ userId, accountIds }),
    columns: [
      { header: 'Name', field: 'name', kind: 'text' },
      { header: 'Type', field: 'type', kind: 'text' },
      { header: 'Currency', field: 'currency', kind: 'text' },
      { header: 'InitialBalance', field: 'initialBalance', kind: 'money' },
      { header: 'CurrentBalance', field: 'currentBalance', kind: 'money' },
      { header: 'Group', field: 'group', kind: 'text' },
      { header: 'ExcludedFromStats', field: 'excludedFromStats', kind: 'boolean' },
      { header: 'Status', field: 'status', kind: 'text' },
      { header: 'BankProvider', field: 'bankProvider', kind: 'text' },
    ],
  },
  balances_history: {
    name: 'balances_history',
    group: 'transactions',
    build: ({ userId, dateRange, accountIds }) => transformBalancesHistory({ userId, dateRange, accountIds }),
    columns: [
      { header: 'Account', field: 'account', kind: 'text' },
      { header: 'Date', field: 'date', kind: 'date' },
      { header: 'BalanceInBaseCurrency', field: 'balanceInBaseCurrency', kind: 'money' },
    ],
  },
  categories: {
    name: 'categories',
    group: 'transactions',
    build: ({ userId }) => transformCategories({ userId }),
    columns: [
      { header: 'Name', field: 'name', kind: 'text' },
      { header: 'ParentCategory', field: 'parentCategory', kind: 'text' },
      { header: 'Color', field: 'color', kind: 'text' },
      { header: 'Icon', field: 'icon', kind: 'text' },
      { header: 'IsSystem', field: 'isSystem', kind: 'boolean' },
    ],
  },
  tags: {
    name: 'tags',
    group: 'transactions',
    build: ({ userId }) => transformTags({ userId }),
    columns: [
      { header: 'Name', field: 'name', kind: 'text' },
      { header: 'Description', field: 'description', kind: 'text' },
      { header: 'Color', field: 'color', kind: 'text' },
    ],
  },
  payees: {
    name: 'payees',
    group: 'transactions',
    build: ({ userId }) => transformPayees({ userId }),
    columns: [
      { header: 'Name', field: 'name', kind: 'text' },
      { header: 'DefaultCategory', field: 'defaultCategory', kind: 'text' },
      { header: 'Aliases', field: 'aliases', kind: 'array' },
      { header: 'DefaultTags', field: 'defaultTags', kind: 'array' },
    ],
  },
  vehicles: {
    name: 'vehicles',
    group: 'transactions',
    build: ({ userId }) => transformVehicles({ userId }),
    columns: [
      { header: 'MakeModel', field: 'makeModel', kind: 'text' },
      { header: 'Year', field: 'year', kind: 'number' },
      { header: 'LinkedAccount', field: 'linkedAccount', kind: 'text' },
      { header: 'InitialCost', field: 'initialCost', kind: 'money' },
      { header: 'Currency', field: 'currency', kind: 'text' },
      { header: 'CurrentMileage', field: 'currentMileage', kind: 'number' },
      { header: 'DepreciationModel', field: 'depreciationModel', kind: 'text' },
    ],
  },
  budgets: {
    name: 'budgets',
    group: 'budgets',
    build: ({ userId }) => transformBudgets({ userId }),
    columns: [
      { header: 'Name', field: 'name', kind: 'text' },
      { header: 'Status', field: 'status', kind: 'text' },
      { header: 'PeriodStart', field: 'periodStart', kind: 'date' },
      { header: 'PeriodEnd', field: 'periodEnd', kind: 'date' },
      { header: 'LimitAmount', field: 'limitAmount', kind: 'money' },
      { header: 'Currency', field: 'currency', kind: 'text' },
      { header: 'Categories', field: 'categories', kind: 'array' },
      { header: 'SpentAmount', field: 'spentAmount', kind: 'money' },
    ],
  },
  subscriptions: {
    name: 'subscriptions',
    group: 'subscriptions',
    build: ({ userId }) => transformSubscriptions({ userId }),
    columns: [
      { header: 'Name', field: 'name', kind: 'text' },
      { header: 'Amount', field: 'amount', kind: 'money' },
      { header: 'Currency', field: 'currency', kind: 'text' },
      { header: 'Frequency', field: 'frequency', kind: 'text' },
      { header: 'StartDate', field: 'startDate', kind: 'date' },
      { header: 'EndDate', field: 'endDate', kind: 'date' },
      { header: 'Category', field: 'category', kind: 'text' },
      { header: 'Account', field: 'account', kind: 'text' },
      { header: 'Active', field: 'active', kind: 'boolean' },
      { header: 'LinkedTransactionsCount', field: 'linkedTransactionsCount', kind: 'number' },
    ],
  },
  transaction_templates: {
    name: 'transaction_templates',
    group: 'transactions',
    build: ({ userId }) => transformTransactionTemplates({ userId }),
    columns: [
      { header: 'Name', field: 'name', kind: 'text' },
      { header: 'Type', field: 'type', kind: 'text' },
      { header: 'Amount', field: 'amount', kind: 'money' },
      { header: 'Currency', field: 'currency', kind: 'text' },
      { header: 'Account', field: 'account', kind: 'text' },
      { header: 'Category', field: 'category', kind: 'text' },
      { header: 'Payee', field: 'payee', kind: 'text' },
      { header: 'Tags', field: 'tags', kind: 'array' },
      { header: 'Note', field: 'note', kind: 'text' },
    ],
  },
  portfolios: {
    name: 'portfolios',
    group: 'investments',
    build: ({ userId }) => transformPortfolios({ userId }),
    columns: [
      { header: 'Name', field: 'name', kind: 'text' },
      { header: 'CashBalances', field: 'cashBalancesDetails', kind: 'text' },
      { header: 'Notes', field: 'notes', kind: 'text' },
    ],
  },
  holdings: {
    name: 'holdings',
    group: 'investments',
    build: ({ userId }) => transformHoldings({ userId }),
    columns: [
      { header: 'Portfolio', field: 'portfolio', kind: 'text' },
      { header: 'SecurityTicker', field: 'securityTicker', kind: 'text' },
      { header: 'SecurityName', field: 'securityName', kind: 'text' },
      { header: 'Quantity', field: 'quantity', kind: 'money' },
      { header: 'CostBasis', field: 'costBasis', kind: 'money' },
      { header: 'CostBasisPerUnit', field: 'costBasisPerUnit', kind: 'money' },
    ],
  },
  investment_transactions: {
    name: 'investment_transactions',
    group: 'investments',
    build: ({ userId, dateRange }) => transformInvestmentTransactions({ userId, dateRange }),
    columns: [
      { header: 'Date', field: 'date', kind: 'date' },
      { header: 'Portfolio', field: 'portfolio', kind: 'text' },
      { header: 'Security', field: 'security', kind: 'text' },
      { header: 'Type', field: 'type', kind: 'text' },
      { header: 'Quantity', field: 'quantity', kind: 'money' },
      { header: 'Price', field: 'price', kind: 'money' },
      { header: 'Fees', field: 'fees', kind: 'money' },
      { header: 'TotalAmount', field: 'totalAmount', kind: 'money' },
      { header: 'Currency', field: 'currency', kind: 'text' },
    ],
  },
  portfolio_transfers: {
    name: 'portfolio_transfers',
    group: 'investments',
    build: ({ userId, dateRange }) => transformPortfolioTransfers({ userId, dateRange }),
    columns: [
      { header: 'Date', field: 'date', kind: 'date' },
      { header: 'FromAccount', field: 'fromAccount', kind: 'text' },
      { header: 'ToAccount', field: 'toAccount', kind: 'text' },
      { header: 'Amount', field: 'amount', kind: 'money' },
      { header: 'Currency', field: 'currency', kind: 'text' },
      { header: 'Note', field: 'note', kind: 'text' },
    ],
  },
};

/** Resolve the union of files across selected groups. */
export function resolveEnabledFiles({ groups }: { groups: ExportGroup[] }): Set<ExportFileName> {
  const enabled = new Set<ExportFileName>();
  for (const domain of Object.values(EXPORT_DOMAINS)) {
    if (groups.includes(domain.group)) enabled.add(domain.name);
  }
  return enabled;
}

/** Column schema for a single file. */
export function columnsFor({ name }: { name: ExportFileName }): readonly ColumnSpec[] {
  return EXPORT_DOMAINS[name].columns;
}
