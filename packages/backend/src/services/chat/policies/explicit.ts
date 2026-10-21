import type { ChatCardDanger, ChatCardKind, ChatEntityKind } from '@bt/shared/types';

import type { ChatEgress, PreviewResolverName } from './rules';

/**
 * Entities the `entity` preview resolver can load: the row a card's `targetFields` name, with the
 * related counts where a count service exists. An update or delete card on any other entity needs
 * an explicit resolver or a place in `CHAT_ARGS_ONLY_TOOLS`.
 */
export const ENTITY_LOADER_KINDS: readonly ChatEntityKind[] = [
  'transaction',
  'account',
  'accountGroup',
  'category',
  'tag',
  'tagReminder',
  'payee',
  'payeeAlias',
  'tracker',
  'budgetPlan',
  'budgetPlanGroup',
  'budgetPlanLine',
  'budgetPlanLineGoal',
  'subscription',
  'loan',
  'vehicle',
  'portfolio',
  'holding',
  'investmentTransaction',
  'transactionGroup',
  'transactionAutomation',
  'transactionTemplate',
  'customCurrency',
  'userCurrency',
  'venturePlatform',
  'ventureDeal',
  'ventureEvent',
  'ventureEventLink',
  'split',
  'portfolioTransfer',
  'attachment',
];

/**
 * What a tool's policy takes from its name's rule unless an entry here says otherwise. A tool
 * appears here only where the rule gets it wrong or cannot decide: an entity the name does not
 * spell, a target argument other than `<entity>Id`, a resolver, a kind, a danger level.
 */
interface ExplicitPolicy {
  kind?: ChatCardKind;
  entity?: ChatEntityKind;
  danger?: ChatCardDanger;
  /** `null` states an args-only card; leaving it out takes the rule's default. */
  previewResolver?: PreviewResolverName | null;
  targetFields?: string[];
  resultIdPath?: string;
  /** Arguments whose meaning depends on the tool, on top of the arguments every tool shares. */
  entityFields?: Record<string, ChatEntityKind>;
}

const ACCOUNT_GROUP = { groupId: 'accountGroup' } as const;
const TRANSACTION_GROUP = { groupId: 'transactionGroup' } as const;
const BUDGET_PLAN_GROUP = { groupId: 'budgetPlanGroup' } as const;
const TRACKER_LINE = { lineId: 'trackerLine' } as const;

export const EXPLICIT_POLICIES: Readonly<Record<string, ExplicitPolicy>> = {
  // Accounts
  adjust_account_balance: { entity: 'account', previewResolver: 'entity', targetFields: ['accountId'] },
  archive_account: { kind: 'update', entity: 'account' },
  unlink_account_from_bank_connection: { entity: 'account', previewResolver: 'entity', targetFields: ['accountId'] },
  update_account_group: { targetFields: ['groupId'], entityFields: ACCOUNT_GROUP },
  move_account_group: {
    kind: 'update',
    entity: 'accountGroup',
    targetFields: ['groupId'],
    entityFields: ACCOUNT_GROUP,
  },
  delete_account_group: { targetFields: ['groupId'], entityFields: ACCOUNT_GROUP },
  add_account_to_group: { kind: 'link', entity: 'accountGroup', entityFields: ACCOUNT_GROUP },
  remove_accounts_from_group: { entity: 'accountGroup', entityFields: ACCOUNT_GROUP },

  // Transactions
  create_transaction: { resultIdPath: '0.id' },
  update_transaction: { targetFields: ['id'] },
  delete_transaction: { targetFields: ['id'] },
  bulk_update_transactions: { previewResolver: 'bulkUpdateTransactions' },
  bulk_delete_transactions: { previewResolver: 'bulkDeleteTransactions' },
  split_transaction: { kind: 'update', entity: 'transaction', targetFields: ['transactionId'] },
  link_refund: { entity: 'transaction' },
  unlink_refund: { entity: 'transaction' },
  link_transfer: { entity: 'transaction' },
  unlink_transfer: { entity: 'transaction' },
  confirm_planned_transaction: { entity: 'transaction', previewResolver: 'entity', targetFields: ['transactionId'] },
  dismiss_transfer_suggestion: { entity: 'transaction' },
  remove_duplicate_transactions: {
    kind: 'bulk',
    entity: 'transaction',
    previewResolver: 'removeDuplicateTransactions',
  },
  restore_removed_transactions: { entity: 'transaction' },
  merge_duplicate_transactions: { entity: 'transaction', previewResolver: 'mergeDuplicateTransactions' },
  keep_pending_as_booked: { entity: 'transaction' },

  // Tags, notifications, settings
  update_tag: { targetFields: ['id'] },
  delete_tag: { targetFields: ['id'] },
  assign_tags_to_transaction: { entity: 'tag' },
  remove_tags_from_transaction: { entity: 'tag' },
  update_tag_reminder: { targetFields: ['tagId', 'reminderId'] },
  delete_tag_reminder: { targetFields: ['tagId', 'reminderId'] },
  mark_notifications_read: { entity: 'notification' },
  dismiss_notification: { entity: 'notification' },
  update_user_settings: { kind: 'settings' },

  // Payees
  update_payee: { targetFields: ['id'] },
  delete_payee: { targetFields: ['id'] },
  merge_payees: { previewResolver: 'mergePayees', entityFields: { sourceId: 'payee', targetId: 'payee' } },
  set_payees_categorization_mode: { kind: 'settings', entity: 'payee' },
  bulk_delete_payees: { previewResolver: 'bulkDeletePayees', entityFields: { ids: 'payee' } },
  ignore_payee_name: { entity: 'payee', previewResolver: 'ignorePayeeName' },
  unignore_payee_name: { entity: 'payee' },
  apply_payee_tags_to_transactions: { entity: 'payee', previewResolver: 'applyPayeeTags' },
  delete_payee_alias: { targetFields: ['payeeId', 'aliasId'] },

  // Trackers
  archive_tracker: { kind: 'update', entity: 'tracker' },
  add_transactions_to_tracker: { kind: 'link', entity: 'tracker' },
  remove_transactions_from_tracker: { entity: 'tracker' },
  create_tracker_line: { entity: 'tracker' },
  update_tracker_line: { entity: 'tracker', targetFields: ['trackerId'], entityFields: TRACKER_LINE },
  delete_tracker_line: { entity: 'tracker', targetFields: ['trackerId'], entityFields: TRACKER_LINE },
  accept_tracker_suggestions: { kind: 'link', entity: 'tracker' },
  reject_tracker_suggestions: { kind: 'link', entity: 'tracker' },

  // Investments
  delete_holding: { targetFields: ['portfolioId', 'securityId'] },
  restore_portfolio: { entity: 'portfolio' },
  update_investment_transaction: {
    targetFields: ['transactionId'],
    entityFields: { transactionId: 'investmentTransaction' },
  },
  delete_investment_transaction: {
    targetFields: ['transactionId'],
    entityFields: { transactionId: 'investmentTransaction' },
  },
  link_transaction_to_portfolio: { entity: 'portfolio' },
  unlink_transaction_from_portfolio: { entity: 'portfolio' },
  transfer_account_to_portfolio: { entity: 'portfolio' },
  transfer_portfolio_to_account: { entity: 'portfolio' },
  create_portfolio_cash_transaction: { kind: 'action', entity: 'portfolio' },
  transfer_between_portfolios: { entity: 'portfolio' },
  exchange_portfolio_currency: { entity: 'portfolio' },
  set_portfolio_transfer_adjustment: { entity: 'portfolioTransfer', targetFields: ['transferId'] },
  delete_portfolio_transfer: { targetFields: ['transferId'] },

  // Transaction groups
  update_transaction_group: { targetFields: ['id'] },
  delete_transaction_group: { targetFields: ['id'] },
  add_transactions_to_group: { kind: 'link', entity: 'transactionGroup', entityFields: TRANSACTION_GROUP },
  remove_transactions_from_group: { entity: 'transactionGroup', entityFields: TRANSACTION_GROUP },

  // Subscriptions
  update_subscription: { targetFields: ['id'] },
  delete_subscription: { targetFields: ['id'] },
  toggle_subscription_active: { kind: 'update', entity: 'subscription', targetFields: ['id'] },
  detect_subscription_candidates: { entity: 'subscription' },
  dismiss_subscription_candidate: { entity: 'subscription' },
  link_transactions_to_subscription: { entity: 'subscription', previewResolver: 'linkTransactionsToSubscription' },
  unlink_transactions_from_subscription: {
    entity: 'subscription',
    previewResolver: 'unlinkTransactionsFromSubscription',
  },
  accept_subscription_candidate: { entity: 'subscription' },
  pay_subscription_period: { entity: 'subscription' },
  skip_subscription_period: { entity: 'subscription' },
  unlink_subscription_period_transaction: { entity: 'subscription' },
  revert_subscription_period: {
    entity: 'subscription',
    danger: 'destructive',
    previewResolver: 'revertSubscriptionPeriod',
  },

  // Automations and templates
  update_transaction_automation: { targetFields: ['id'] },
  delete_transaction_automation: { targetFields: ['id'] },
  reorder_transaction_automations: { entity: 'transactionAutomation', entityFields: { ids: 'transactionAutomation' } },
  apply_transaction_automation: { entity: 'transactionAutomation', previewResolver: 'applyTransactionAutomation' },
  update_transaction_template: { targetFields: ['templateId'] },
  delete_transaction_template: { targetFields: ['templateId'] },

  // Venture
  update_venture_platform: { targetFields: ['platformId'] },
  delete_venture_platform: { targetFields: ['platformId'] },
  update_venture_deal: { targetFields: ['dealId'] },
  delete_venture_deal: { targetFields: ['dealId'] },
  update_venture_event: { targetFields: ['eventId'] },
  delete_venture_event: { targetFields: ['eventId'] },
  link_transactions_to_venture_event: { entity: 'ventureEvent' },
  replace_venture_event_links: { kind: 'link', entity: 'ventureEvent' },
  delete_venture_event_link: { targetFields: ['eventId', 'linkId'] },

  // Currencies
  create_custom_currency: { resultIdPath: 'code' },
  update_custom_currency: { targetFields: ['code'], entityFields: { code: 'customCurrency' } },
  delete_custom_currency: { targetFields: ['code'], entityFields: { code: 'customCurrency' } },
  set_currency_rate_source: {
    entity: 'customCurrency',
    targetFields: ['code'],
    entityFields: { code: 'customCurrency' },
  },
  delete_exchange_rates: { previewResolver: 'deleteExchangeRates' },
  add_user_currencies: { kind: 'create', entity: 'userCurrency' },
  update_user_currency: { targetFields: ['currencyCode'] },
  delete_user_currency: { targetFields: ['currencyCode'] },
  change_base_currency: { entity: 'userCurrency', previewResolver: 'changeBaseCurrency' },

  // Loans
  add_loan_note: { entity: 'loan' },
  link_loan_payments: { entity: 'loan' },
  unlink_loan_payment: { entity: 'loan' },

  // Budget plans
  create_budget_plan: { resultIdPath: 'plan.id' },
  update_budget_plan: { targetFields: ['planId'] },
  delete_budget_plan: { targetFields: ['planId'] },
  restore_budget_plan: { entity: 'budgetPlan' },
  set_budget_plan_accounts: { entity: 'budgetPlan', targetFields: ['planId'] },
  update_budget_plan_group: { targetFields: ['planId', 'groupId'], entityFields: BUDGET_PLAN_GROUP },
  delete_budget_plan_group: { targetFields: ['planId', 'groupId'], entityFields: BUDGET_PLAN_GROUP },
  create_budget_plan_line: { entityFields: BUDGET_PLAN_GROUP },
  update_budget_plan_line: { targetFields: ['planId', 'lineId'], entityFields: BUDGET_PLAN_GROUP },
  delete_budget_plan_line: { targetFields: ['planId', 'lineId'] },
  archive_budget_plan_line: { kind: 'update', entity: 'budgetPlanLine', targetFields: ['planId', 'lineId'] },
  add_suggested_budget_plan_lines: { entity: 'budgetPlan' },
  set_budget_plan_layout: { entity: 'budgetPlan', targetFields: ['planId'], entityFields: BUDGET_PLAN_GROUP },
  set_budget_plan_line_goal: { targetFields: ['planId', 'lineId'] },
  delete_budget_plan_line_goal: { targetFields: ['planId', 'lineId'] },
  snooze_budget_plan_line_goal: { entity: 'budgetPlanLineGoal' },
  set_budget_plan_assignment: { entity: 'budgetPlanLine', previewResolver: 'budgetPlanAssignment' },

  // Imports
  delete_import_batch: { previewResolver: 'deleteImportBatch' },
};

/**
 * Tools that queue work or commit on their own, so a rollback cannot take them back and they never
 * join an approval chain. Services enqueue their background jobs after commit, which leaves these
 * two.
 */
export const STANDALONE_TOOLS: readonly string[] = ['change_base_currency', 'delete_import_batch'];

/** A level a tool reaches on a path its arguments pick, on top of its static level. */
export const CONDITIONAL_DANGER: Readonly<Record<string, (params: { args: unknown }) => ChatCardDanger>> = {
  // With `force` the service deletes the payee the ignored name resolves to.
  ignore_payee_name: ({ args }) => ((args as { force?: unknown } | null)?.force === true ? 'destructive' : 'none'),
};

const URL_TEMPLATE_VARIABLES = /\{(?:date|code|quote)\}/g;

const hostOf = ({ urlTemplate }: { urlTemplate: string }): string => {
  try {
    return new URL(urlTemplate.replace(URL_TEMPLATE_VARIABLES, 'x')).hostname;
  } catch {
    return '';
  }
};

/**
 * Write tools that make the server send a request to a host their arguments name, now or on a
 * later sync. Audited against every outbound call in the services behind the write tools
 * (`createGuardedFetch` and `fetch(`):
 * - the HTTP rate source fetches the user's own `urlTemplate` on every sync: egress;
 * - brand-logo, securities, CoinGecko, exchange-rate and bank providers use fixed hosts, and an
 *   argument only picks what they look up;
 * - a stored `logoUrl` is shown by the user's browser, not fetched by the server, and the card
 *   lists it as a field;
 * - `test_currency_rate_source` fetches once and saves nothing; it is excluded from the chat.
 * A function of the arguments, so a CoinGecko or peg source is not egress while an HTTP one is.
 */
export const EGRESS_TOOLS: Readonly<Record<string, (params: { args: unknown }) => ChatEgress | null>> = {
  set_currency_rate_source: ({ args }) => {
    const { rateSource, config } = (args ?? {}) as { rateSource?: unknown; config?: { urlTemplate?: unknown } };
    if (rateSource !== 'http') return null;

    const urlTemplate = typeof config?.urlTemplate === 'string' ? config.urlTemplate : '';
    return { url: urlTemplate, host: hostOf({ urlTemplate }) };
  },
};

interface ReadToolPagination {
  limitArg: string;
  /** Offset-paged tools. */
  offsetArg?: string;
  /** Page-numbered tools. */
  pageArg?: string;
  /** The page size `run_analysis` asks for: the tool's own cap where it has one, else a safe 100. */
  maxLimit: number;
}

/**
 * Read tools `run_analysis` may page through, up to its row cap. A read that returns everything in
 * one call (`get_payees`) is not listed.
 */
export const READ_TOOL_PAGINATION: Readonly<Record<string, ReadToolPagination>> = {
  search_transactions: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 500 },
  get_notifications: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 100 },
  get_investment_transactions: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 100 },
  list_portfolio_transfers: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 100 },
  get_subscription_periods: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 50 },
  list_budget_plan_periods: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 200 },
  list_import_batches: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 100 },
  get_currency_rate_history: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 100 },
  list_transfer_suggestions: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 50 },
  get_refunds: { limitArg: 'limit', pageArg: 'page', maxLimit: 100 },
  get_portfolios: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 100 },
  list_venture_platforms: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 100 },
  list_venture_deals: { limitArg: 'limit', offsetArg: 'offset', maxLimit: 100 },
};

/** Read tools that call a third party; a message may make 10 such calls. */
export const THIRD_PARTY_READ_TOOLS: readonly string[] = ['search_coingecko_coins', 'search_securities'];
