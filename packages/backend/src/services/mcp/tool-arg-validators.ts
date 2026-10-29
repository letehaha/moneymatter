import { validateBulkDeleteTransactionsArgs } from './tools/bulk-delete-transactions';
import { validateCreateAccountArgs } from './tools/create-account';
import { validateCreateAccountGroupArgs } from './tools/create-account-group';
import { validateCreateBudgetPlanArgs } from './tools/create-budget-plan';
import { validateCreateBudgetPlanGroupArgs } from './tools/create-budget-plan-group';
import { validateCreateBudgetPlanLineArgs } from './tools/create-budget-plan-line';
import { validateCreateHoldingArgs } from './tools/create-holding';
import { validateCreateInvestmentTransactionArgs } from './tools/create-investment-transaction';
import { validateCreateLoanArgs } from './tools/create-loan';
import { validateCreateTrackerArgs } from './tools/create-tracker';
import { validateCreateTransactionArgs } from './tools/create-transaction';
import { validateCreateVehicleArgs } from './tools/create-vehicle';
import { validateDismissTransferSuggestionArgs } from './tools/dismiss-transfer-suggestion';
import { validatePaySubscriptionPeriodArgs } from './tools/pay-subscription-period';
import { validateRestoreBudgetPlanArgs } from './tools/restore-budget-plan';
import { validateSetBudgetPlanAccountsArgs } from './tools/set-budget-plan-accounts';
import { validateSetBudgetPlanAssignmentArgs } from './tools/set-budget-plan-assignment';
import { validateSetBudgetPlanLayoutArgs } from './tools/set-budget-plan-layout';
import { validateSetBudgetPlanLineGoalArgs } from './tools/set-budget-plan-line-goal';
import { validateUpdateAccountArgs } from './tools/update-account';
import { validateUpdateAccountGroupArgs } from './tools/update-account-group';
import { validateUpdateBudgetPlanArgs } from './tools/update-budget-plan';
import { validateUpdateBudgetPlanGroupArgs } from './tools/update-budget-plan-group';
import { validateUpdateBudgetPlanLineArgs } from './tools/update-budget-plan-line';
import { validateUpdateLoanArgs } from './tools/update-loan';
import { validateUpdatePayeeArgs } from './tools/update-payee';
import { validateUpdatePortfolioArgs } from './tools/update-portfolio';
import { validateUpdateTrackerArgs } from './tools/update-tracker';
import { validateUpdateTransactionArgs } from './tools/update-transaction';
import { validateUpdateUserSettingsArgs } from './tools/update-user-settings';
import { validateUpdateVehicleArgs } from './tools/update-vehicle';
import { validateUpdateVentureDealArgs } from './tools/update-venture-deal';
import { validateUpdateVenturePlatformArgs } from './tools/update-venture-platform';

/**
 * Argument validators of the write tools, by tool name. A validator holds every check the handler
 * runs on its arguments before the service call, other than the guards (scope, feature, lock, rate
 * limit): shared schemas, `assert…Args` helpers and refusal helpers. The handler calls it at the
 * point the inline check stood, and the chat calls it from the catalog entry.
 */

/** A pure `validate<Pascal>Args({ args })`: no guards, no I/O. It throws on a bad input. */
type ToolArgValidator = (params: { args: never }) => unknown;

export const TOOL_ARG_VALIDATORS: Readonly<Record<string, ToolArgValidator>> = {
  bulk_delete_transactions: validateBulkDeleteTransactionsArgs,
  create_account: validateCreateAccountArgs,
  create_account_group: validateCreateAccountGroupArgs,
  create_budget_plan: validateCreateBudgetPlanArgs,
  create_budget_plan_group: validateCreateBudgetPlanGroupArgs,
  create_budget_plan_line: validateCreateBudgetPlanLineArgs,
  create_holding: validateCreateHoldingArgs,
  create_investment_transaction: validateCreateInvestmentTransactionArgs,
  create_loan: validateCreateLoanArgs,
  create_tracker: validateCreateTrackerArgs,
  create_transaction: validateCreateTransactionArgs,
  create_vehicle: validateCreateVehicleArgs,
  dismiss_transfer_suggestion: validateDismissTransferSuggestionArgs,
  pay_subscription_period: validatePaySubscriptionPeriodArgs,
  restore_budget_plan: validateRestoreBudgetPlanArgs,
  set_budget_plan_accounts: validateSetBudgetPlanAccountsArgs,
  set_budget_plan_assignment: validateSetBudgetPlanAssignmentArgs,
  set_budget_plan_layout: validateSetBudgetPlanLayoutArgs,
  set_budget_plan_line_goal: validateSetBudgetPlanLineGoalArgs,
  update_account: validateUpdateAccountArgs,
  update_account_group: validateUpdateAccountGroupArgs,
  update_budget_plan: validateUpdateBudgetPlanArgs,
  update_budget_plan_group: validateUpdateBudgetPlanGroupArgs,
  update_budget_plan_line: validateUpdateBudgetPlanLineArgs,
  update_loan: validateUpdateLoanArgs,
  update_payee: validateUpdatePayeeArgs,
  update_portfolio: validateUpdatePortfolioArgs,
  update_tracker: validateUpdateTrackerArgs,
  update_transaction: validateUpdateTransactionArgs,
  update_user_settings: validateUpdateUserSettingsArgs,
  update_vehicle: validateUpdateVehicleArgs,
  update_venture_deal: validateUpdateVentureDealArgs,
  update_venture_platform: validateUpdateVenturePlatformArgs,
};
