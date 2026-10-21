import type { ChatEntityKind } from '@bt/shared/types';

/**
 * Argument names that name the same entity in every tool that takes them. A name that means
 * different things in different tools (`id`, `ids`, `groupId`, `code`, `sourceId`, `targetId`, and
 * `transactionId` on the investment tools) is not here: the tool's explicit entry maps it.
 */
const GLOBAL_ENTITY_FIELDS: Readonly<Record<string, ChatEntityKind>> = {
  accountId: 'account',
  accountIds: 'account',
  destinationAccountId: 'account',
  categoryId: 'category',
  categoryIds: 'category',
  parentId: 'category',
  defaultCategoryId: 'category',
  replaceWithCategoryId: 'category',
  savingsCategoryIds: 'category',
  taxCategoryIds: 'category',
  incomeCategoryIds: 'category',
  payeeId: 'payee',
  payeeIds: 'payee',
  tagId: 'tag',
  tagIds: 'tag',
  defaultTagIds: 'tag',
  transactionId: 'transaction',
  transactionIds: 'transaction',
  excludedIds: 'transaction',
  originalTxId: 'transaction',
  refundTxId: 'transaction',
  baseTxId: 'transaction',
  oppositeTxId: 'transaction',
  expenseTransactionId: 'transaction',
  incomeTransactionId: 'transaction',
  destinationTransactionId: 'transaction',
  existingTransactionId: 'transaction',
  survivorId: 'transaction',
  splitId: 'split',
  trackerId: 'tracker',
  planId: 'budgetPlan',
  lineId: 'budgetPlanLine',
  ungroupedLineIds: 'budgetPlanLine',
  loanId: 'loan',
  vehicleId: 'vehicle',
  portfolioId: 'portfolio',
  fromPortfolioId: 'portfolio',
  toPortfolioId: 'portfolio',
  subscriptionId: 'subscription',
  automationId: 'transactionAutomation',
  templateId: 'transactionTemplate',
  platformId: 'venturePlatform',
  dealId: 'ventureDeal',
  eventId: 'ventureEvent',
  attachmentId: 'attachment',
  batchId: 'importBatch',
  notificationId: 'notification',
  transferId: 'portfolioTransfer',
  parentGroupId: 'accountGroup',
  newParentGroupId: 'accountGroup',
  reminderId: 'tagReminder',
  aliasId: 'payeeAlias',
  linkId: 'ventureEventLink',
  currencyCode: 'userCurrency',
  originalCurrencyCode: 'userCurrency',
  expectedCurrencyCode: 'userCurrency',
  fromCurrencyCode: 'userCurrency',
  toCurrencyCode: 'userCurrency',
  newCurrencyCode: 'userCurrency',
};

/**
 * Id-like arguments (`…Id`, `…Ids`) that name no entity the chat can label, by tool. The drift suite
 * requires every other id-like argument of a write tool to be mapped, so a new one cannot slip by.
 */
export const UNMAPPED_ID_FIELDS: Readonly<Record<string, string[]>> = {
  // The id every leg of one transfer shares, not a transaction id.
  unlink_transfer: ['transferIds'],
  // Ignored payee names are listed by `get_ignored_payee_names` and have no card entity.
  unignore_payee_name: ['ignoredNameId'],
  // Securities are looked up through `search_securities`; a card shows the symbol the model passed.
  create_holding: ['securityId'],
  delete_holding: ['securityId'],
  create_investment_transaction: ['securityId'],
  // Tracker lines and smart-tracking suggestions are rows inside a tracker, without an entity page.
  accept_tracker_suggestions: ['suggestionIds'],
  reject_tracker_suggestions: ['suggestionIds'],
  // Subscription candidates and budget plan periods are short-lived rows without an entity page.
  dismiss_subscription_candidate: ['candidateId'],
  accept_subscription_candidate: ['candidateId'],
  pay_subscription_period: ['periodId'],
  skip_subscription_period: ['periodId'],
  unlink_subscription_period_transaction: ['periodId'],
  revert_subscription_period: ['periodId'],
  set_budget_plan_line_goal: ['periodId'],
  snooze_budget_plan_line_goal: ['periodId'],
  set_budget_plan_assignment: ['periodId'],
};

export function buildEntityFields({
  entity,
  overrides,
}: {
  entity: ChatEntityKind;
  overrides?: Readonly<Record<string, ChatEntityKind>>;
}): Readonly<Record<string, ChatEntityKind>> {
  return { ...GLOBAL_ENTITY_FIELDS, id: entity, ...overrides };
}
