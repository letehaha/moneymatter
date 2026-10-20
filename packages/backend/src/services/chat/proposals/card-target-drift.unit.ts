import { type ChatEntityKind } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';

// The import chains of the services behind the catalog's tools open Redis connections.
jest.mock('@services/categories.service', () => ({ getCategories: jest.fn() }));
jest.mock('@services/accounts.service', () => ({ getAccounts: jest.fn() }));

import '@models/index';

import AccountGroups from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import BudgetLineGoals from '@models/budget-line-goals.model';
import BudgetLineGroups from '@models/budget-line-groups.model';
import BudgetLines from '@models/budget-lines.model';
import Categories from '@models/categories.model';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransactions from '@models/investments/investment-transaction.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import LoanDetails from '@models/loan-details.model';
import PayeeAliases from '@models/payee-aliases.model';
import Payees from '@models/payees.model';
import Subscriptions from '@models/subscriptions.model';
import TagReminders from '@models/tag-reminders.model';
import Tags from '@models/tags.model';
import Trackers from '@models/trackers.model';
import TransactionAttachments from '@models/transaction-attachments.model';
import TransactionAutomations from '@models/transaction-automations.model';
import TransactionGroups from '@models/transaction-groups.model';
import TransactionSplits from '@models/transaction-splits.model';
import TransactionTemplates from '@models/transaction-templates.model';
import Transactions from '@models/transactions.model';
import UsersCurrencies from '@models/users-currencies.model';
import Vehicles from '@models/vehicles.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import VentureEvents from '@models/venture/venture-events.model';
import VenturePlatforms from '@models/venture/venture-platforms.model';

import { getToolCatalog } from '../../mcp/tool-catalog';
import { resolveToolPolicy } from '../policies';
import { IDENTIFYING_FIELDS } from './card-target';

/**
 * The model behind each entity kind that an update or delete card can target. The card shows the row the
 * preview read, so a kind whose columns match none of the identifying fields would show an empty record.
 * A kind with a card and no entry here fails the suite, so a new entity is added with its model.
 */
const ENTITY_MODELS: Partial<Record<ChatEntityKind, { getAttributes: () => Record<string, unknown> }>> = {
  transaction: Transactions,
  account: Accounts,
  accountGroup: AccountGroups,
  category: Categories,
  tag: Tags,
  tagReminder: TagReminders,
  payee: Payees,
  payeeAlias: PayeeAliases,
  tracker: Trackers,
  budgetPlan: Trackers,
  budgetPlanLine: BudgetLines,
  budgetPlanGroup: BudgetLineGroups,
  budgetPlanLineGoal: BudgetLineGoals,
  subscription: Subscriptions,
  loan: LoanDetails,
  vehicle: Vehicles,
  portfolio: Portfolios,
  holding: Holdings,
  investmentTransaction: InvestmentTransactions,
  portfolioTransfer: PortfolioTransfers,
  transactionGroup: TransactionGroups,
  transactionAutomation: TransactionAutomations,
  transactionTemplate: TransactionTemplates,
  userCurrency: UsersCurrencies,
  venturePlatform: VenturePlatforms,
  ventureDeal: VentureDeals,
  ventureEvent: VentureEvents,
  ventureEventLink: VentureEventLinks,
  split: TransactionSplits,
  attachment: TransactionAttachments,
};

/** Entity kinds whose row is not a single model's (a plan is read with its budget table, a currency from two). */
const NO_MODEL_ROW: ChatEntityKind[] = ['customCurrency', 'importBatch', 'notification', 'userSettings'];

const cardEntities = () => {
  const entities = new Set<ChatEntityKind>();
  for (const entry of getToolCatalog().filter((tool) => tool.access === 'write')) {
    const policy = resolveToolPolicy({ name: entry.name, args: {} });
    if (policy && (policy.kind === 'update' || policy.kind === 'delete') && policy.targetFields.length > 0) {
      entities.add(policy.entity);
    }
  }
  return [...entities];
};

describe('the record an update or delete card shows', () => {
  it('has a model for every entity kind a card can target', () => {
    const missing = cardEntities().filter((entity) => !(entity in ENTITY_MODELS) && !NO_MODEL_ROW.includes(entity));

    expect(missing).toEqual([]);
  });

  it('finds at least one identifying field among the columns of each of them', () => {
    const keys = new Set(IDENTIFYING_FIELDS.map((field) => field.key));
    const empty = Object.entries(ENTITY_MODELS)
      .filter(([entity]) => cardEntities().includes(entity as ChatEntityKind))
      .filter(([, model]) => !Object.keys(model!.getAttributes()).some((attribute) => keys.has(attribute)))
      .map(([entity]) => entity);

    expect(empty).toEqual([]);
  });
});
