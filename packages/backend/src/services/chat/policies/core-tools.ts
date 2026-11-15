/**
 * The tools every chat step sends to the model, each with the reason it earns its schema tokens: the
 * reads that answer most questions. Every other tool, the writes included, is found through
 * `find_capabilities` and added to the active set once the model asks for it; a turn that is
 * likely to change data starts with `CHAT_WRITE_PRELOAD_TOOLS` already active. The core stays
 * under the schema budget the capability drift suite checks.
 */
export const CHAT_CORE_TOOL_REASONS: Readonly<Record<string, string>> = {
  // Reading the user's books
  get_user_profile: 'Base currency, locale and plan: the context almost every answer needs.',
  get_accounts: 'The first lookup for any question or change that names an account.',
  get_account: 'One account with its balance and details.',
  search_transactions: 'The main way to find transactions by date, account, category, payee or text.',
  get_transactions_by_id: 'Re-reads transactions by id, for cards that edit or delete them.',
  get_transactions_summary: 'Totals over a filter, for "how much did I spend on ..." questions.',
  get_categories: 'Maps a category name to an id before any categorizing change.',
  get_tags: 'Maps a tag name to an id before any tagging change.',
  get_payees: 'Maps a merchant name to a payee id, and shows duplicates worth merging.',
  get_trackers: 'Lists trackers with their limits and lines.',
  get_tracker: 'One tracker with its limit, lines and spending.',
  get_spending_by_categories: 'Breakdown behind most "where did my money go" answers and donut charts.',
  get_cash_flow: 'Income against expenses over time, for line and bar charts.',
  get_balance_history: 'Balance over time for one account or all of them.',
  get_total_balance: 'Net balance on a date.',
  get_net_worth_history: 'Net worth over time, including portfolios.',
  get_expenses_for_period: 'Expense total for a period, excluding chosen categories.',
  get_pivot_report: 'Group any measure by any dimension without a custom analysis.',
  get_user_currencies: 'The currencies the user holds, for amounts and conversions.',
  get_subscriptions: 'Recurring payments, a frequent question and a frequent match target for imports.',
};

export const CHAT_CORE_TOOLS: readonly string[] = Object.keys(CHAT_CORE_TOOL_REASONS);

/**
 * The write tools of the commonest changes (log, fix, tag and delete transactions, and the records an
 * import needs first, which later cards reference with a `$proposal:` ref). They are not sent on every
 * step, so an answer turn does not pay their schema; a turn that carries an attachment or continues a
 * thread that already has cards starts with them active, and any other turn finds them through
 * `find_capabilities`.
 */
export const CHAT_WRITE_PRELOAD_REASONS: Readonly<Record<string, string>> = {
  // Changing the user's books (each becomes a card)
  create_transaction: 'The most common change: log an expense, income or transfer from a receipt or a statement line.',
  update_transaction: 'Fix an amount, date, category, payee or note.',
  delete_transaction: 'Remove a duplicate or a wrong entry.',
  bulk_update_transactions: 'Recategorize or tag many transactions in one card.',
  bulk_delete_transactions: 'Delete duplicates found in a statement or by a filter, under a typed confirmation.',
  create_category: 'A category an import needs, which later cards reference with a $proposal: ref.',
  create_tag: 'A tag an import needs, which later cards reference with a $proposal: ref.',
  assign_tags_to_transaction: 'Tag a set of transactions.',
  create_payee: 'A payee an import needs, which later cards reference with a $proposal: ref.',
  create_account: 'An account an import needs, which later cards reference with a $proposal: ref.',
};

export const CHAT_WRITE_PRELOAD_TOOLS: readonly string[] = Object.keys(CHAT_WRITE_PRELOAD_REASONS);

/** Whether a turn starts with the preloaded writes: it carries an attachment, or its thread already has cards. */
export const shouldPreloadWrites = ({
  attachmentCount,
  proposalCount,
}: {
  attachmentCount: number;
  proposalCount: number;
}): boolean => attachmentCount > 0 || proposalCount > 0;
