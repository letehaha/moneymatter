import { ACCOUNT_CATEGORIES } from './accounts';
import { RecordId } from './record-id';

export const BUDGET_PLAN_CADENCES = ['days', 'months', 'semi_monthly'] as const;
export type BudgetPlanCadence = (typeof BUDGET_PLAN_CADENCES)[number];
export const BUDGET_PLAN_MAX_INTERVAL_N: Record<BudgetPlanCadence, number> = { days: 366, months: 12, semi_monthly: 1 };

export const BUDGET_PLAN_TRASH_RETENTION_DAYS = 30;

export const BUDGET_PLAN_CARRY_POLICIES = ['floor', 'signed', 'none'] as const;
export type BudgetPlanCarryPolicy = (typeof BUDGET_PLAN_CARRY_POLICIES)[number];

export const BUDGET_PLAN_TYPE_KEYS = ['category_caps'] as const;
export type BudgetPlanTypeKey = (typeof BUDGET_PLAN_TYPE_KEYS)[number];

export const BUDGET_PLAN_NAME_MAX_LENGTH = 200;

export const BUDGET_LINE_GOAL_BEHAVIORS = ['budget_another', 'refill_up_to', 'reach_balance'] as const;
export type BudgetLineGoalBehavior = (typeof BUDGET_LINE_GOAL_BEHAVIORS)[number];

export const BUDGET_LINE_GOAL_FREQUENCIES = [
  'every_period',
  'weekly',
  'biweekly',
  'yearly',
  'by_date',
  'open_ended',
] as const;
export type BudgetLineGoalFrequency = (typeof BUDGET_LINE_GOAL_FREQUENCIES)[number];

export const BUDGET_LINE_GOAL_BEHAVIORS_BY_FREQUENCY: Record<
  BudgetLineGoalFrequency,
  readonly BudgetLineGoalBehavior[]
> = {
  every_period: ['budget_another', 'refill_up_to'],
  weekly: ['budget_another', 'refill_up_to'],
  biweekly: ['budget_another', 'refill_up_to'],
  yearly: ['budget_another', 'refill_up_to'],
  by_date: ['budget_another', 'refill_up_to', 'reach_balance'],
  open_ended: ['reach_balance'],
};

export const BUDGET_LINE_GOAL_REPEAT_UNITS = ['months', 'years'] as const;
export type BudgetLineGoalRepeatUnit = (typeof BUDGET_LINE_GOAL_REPEAT_UNITS)[number];

/** Frequencies that need an anchor date. */
export const BUDGET_LINE_GOAL_ANCHORED_FREQUENCIES: readonly BudgetLineGoalFrequency[] = [
  'biweekly',
  'yearly',
  'by_date',
];
export const BUDGET_LINE_GOAL_REPEAT_MAX: Record<BudgetLineGoalRepeatUnit, number> = { months: 11, years: 5 };

export type BudgetLineGoalStatus = 'snoozed' | 'achieved' | 'funded' | 'underfunded';

export type BudgetPlanCoverageState = 'prepared' | 'left_to_cover' | 'over_committed' | 'nothing_tracked';

export const BUDGET_ASSIGNMENT_SCOPES = ['from_here', 'this_period'] as const;
export type BudgetAssignmentScope = (typeof BUDGET_ASSIGNMENT_SCOPES)[number];

/** The account categories a plan may attach. */
export const BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES: readonly ACCOUNT_CATEGORIES[] = [
  ACCOUNT_CATEGORIES.general,
  ACCOUNT_CATEGORIES.cash,
  ACCOUNT_CATEGORIES.currentAccount,
  ACCOUNT_CATEGORIES.saving,
  ACCOUNT_CATEGORIES.creditCard,
  ACCOUNT_CATEGORIES.overdraft,
];

export interface BudgetPlanModel {
  id: RecordId;
  userId: number;
  name: string;
  type: BudgetPlanTypeKey;
  /** Base currency stamped at creation; assigned amounts are in it. */
  currencyCode: string;
  cadence: BudgetPlanCadence;
  /** Every N days or months. Always 1 for `semi_monthly`. */
  intervalN: number;
  /** 'yyyy-MM-dd'. Period boundaries derive from it, never from the previous boundary. */
  anchorDate: string;
  /** Day of month, `semi_monthly` only. */
  secondAnchorDay: number | null;
  /** 'yyyy-MM-dd', the first budgeted day and a period start. */
  epochDate: string;
  carryPolicy: BudgetPlanCarryPolicy;
  autoAttachAccounts: boolean;
  /** 'yyyy-MM-dd', the start of the pool's first period; `null` when the plan isn't funded from a pool. */
  poolFrom: string | null;
  /** Keep Ready to Assign at 0. Only `true` while the pool is on. */
  zeroSum: boolean;
  expectedIncome: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface BudgetPlanLineEntry {
  id: string;
  name: string;
  sortOrder: number;
  /** `null` = ungrouped. */
  groupId: string | null;
  activeFrom: string;
  activeUntil: string | null;
  categoryIds: string[];
}

export interface BudgetPlanLineGroup {
  id: RecordId;
  name: string;
  sortOrder: number;
}

export interface BudgetPlanDetails {
  plan: BudgetPlanModel;
  accountIds: string[];
  lines: BudgetPlanLineEntry[];
}

export interface CreateBudgetPlanResponse extends BudgetPlanDetails {
  suggestedLinesFailed?: boolean;
  suggestionAnswersIgnored?: boolean;
}

export interface BudgetPlanPeriod {
  id: string;
  startDate: string;
  /** Exclusive. */
  endDate: string;
  isCurrent: boolean;
}

export interface BudgetPlanPeriodViewLine {
  lineId: string;
  name: string;
  sortOrder: number;
  groupId: string | null;
  categoryIds: string[];
  assigned: number;
  /** The part of `assigned` that Ready to Assign counts: 0 for a recurring baseline in a future period. */
  poolAssigned: number;
  assignedSource: 'override' | 'baseline' | 'none';
  /** Signed: expenses are negative. */
  activity: number;
  carriedIn: number;
  available: number;
  carryPolicy: BudgetPlanCarryPolicy;
  goal: BudgetPlanPeriodViewLineGoal | null;
}

export interface BudgetLineGoal {
  lineId: string;
  frequency: BudgetLineGoalFrequency;
  behavior: BudgetLineGoalBehavior;
  amount: number;
  /** Weekly only; 0 is Sunday. */
  weekday: number | null;
  /** 'yyyy-MM-dd'. Biweekly: a first occurrence. Yearly: the first due date. By date: the due date. */
  anchorDate: string | null;
  /** By-date `budget_another` / `refill_up_to` only; both set or both `null`. */
  repeatEvery: number | null;
  repeatUnit: BudgetLineGoalRepeatUnit | null;
  stopAtBalance: number | null;
  /** Most a `refill_up_to` goal asks per period. */
  fundingCap: number | null;
  /** Start of the period the goal was created in. */
  startPeriodStart: string;
  /** Start of the one period the goal sits out. */
  snoozedPeriodStart: string | null;
}

export interface BudgetLineGoalFundingPlanRow {
  periodStart: string;
  amount: number;
  leftAfter: number;
}

export interface BudgetPlanPeriodViewLineGoal extends Omit<BudgetLineGoal, 'lineId' | 'snoozedPeriodStart'> {
  /** Due date of the active cycle (yearly, by date). */
  dueDate: string | null;
  /** Still to assign this period. */
  ask: number;
  target: number;
  /** What this period calls for; 0 for open-ended. */
  periodTarget: number;
  progress: number;
  status: BudgetLineGoalStatus;
  /** What "Budget $X" assigns: the ask plus any overspend; the whole gap for open-ended. */
  budgetAmount: number;
  /** Weekly / biweekly occurrence dates inside the period. */
  occurrences: string[] | null;
  fundedThrough: string | null;
  nextNeededDate: string | null;
  /** Yearly / by date: this period's ask, then the even split up to the due period. */
  fundingPlan: BudgetLineGoalFundingPlanRow[] | null;
}

export interface BudgetPlanGoalsSummary {
  count: number;
  /** Per-period targets: the amount of every-period goals plus the per-period share of dated ones. */
  totalTarget: number;
  stillNeeded: number;
  underfunded: { lineId: string; ask: number }[];
  expectedIncome: number | null;
}

export interface BudgetPlanCoverage {
  periodId: string;
  startDate: string;
  /** 'yyyy-MM-dd', exclusive. */
  endDate: string;
  target: number;
  linedUp: number;
  percent: number;
  left: number;
  state: BudgetPlanCoverageState;
}

export interface BudgetPlanPool {
  readyToAssign: number;
  /** Assigned in later periods out of this period's money. */
  committedLater: number;
  /** `outsideSpending` is <= 0. */
  flow: { leftOver: number; income: number; outsideSpending: number; fromLines: number; assigned: number };
  balance: { cash: number; inLines: number; drift: number };
}

export interface BudgetPlanPeriodView {
  period: BudgetPlanPeriod;
  header: { totalAssigned: number; totalActivity: number; totalAvailable: number; totalCarriedIn: number };
  /** Sorted by `sortOrder`. */
  groups: BudgetPlanLineGroup[];
  lines: BudgetPlanPeriodViewLine[];
  /** `null` when the plan isn't funded from a pool. */
  pool: BudgetPlanPool | null;
  unbudgeted: { categoryId: string; activity: number }[];
  /** `null` when no line has a goal. */
  goals: BudgetPlanGoalsSummary | null;
  /** The next period's readiness; `null` without a pool or a next period. */
  coverage: BudgetPlanCoverage | null;
}

export interface BudgetPlanTrendPeriod {
  periodId: string;
  startDate: string;
  /** Exclusive. */
  endDate: string;
  assigned: number;
  activity: number;
  carriedIn: number;
  available: number;
  lines: { lineId: string; assigned: number; activity: number; available: number }[];
}

export interface BudgetPlanTrends {
  /** Oldest first. */
  periods: BudgetPlanTrendPeriod[];
}

export interface BudgetPlanScheduledItem {
  source: 'subscription' | 'planned';
  id: string;
  name: string;
  date: string;
  /** Base currency, signed: outflows are negative. */
  amount: number;
  currencyCode: string;
  nativeAmount: number;
  categoryId: string | null;
  lineId: string | null;
  accountId: string | null;
}

export interface BudgetPlanScheduled {
  /** Sorted by date. */
  items: BudgetPlanScheduledItem[];
  /** `total` is signed, so outflows total <= 0. */
  outflows: { total: number; count: number };
  inflows: { total: number; count: number };
  nextDate: string | null;
}

export interface SetBudgetPlanAssignmentPayload {
  scope: BudgetAssignmentScope;
  /** `undefined` leaves the column untouched, `null` clears it. */
  amount?: number | null;
  carryPolicy?: BudgetPlanCarryPolicy | null;
}

/** Array order is the new `sortOrder`. Lines left out, archived ones say, keep their group and order. */
export interface SetBudgetPlanLayoutPayload {
  groups: { id: string; lineIds: string[] }[];
  ungroupedLineIds: string[];
}

export interface SetBudgetLineGoalPayload {
  frequency: BudgetLineGoalFrequency;
  behavior: BudgetLineGoalBehavior;
  amount: number;
  weekday?: number | null;
  anchorDate?: string | null;
  repeatEvery?: number | null;
  repeatUnit?: BudgetLineGoalRepeatUnit | null;
  stopAtBalance?: number | null;
  fundingCap?: number | null;
  /** Sets "Started" on create; ignored on update. Defaults to the current period. */
  periodId?: string;
}

export interface CreateBudgetPlanPayload {
  name: string;
  type: BudgetPlanTypeKey;
  cadence: BudgetPlanCadence;
  intervalN?: number;
  anchorDate: string;
  secondAnchorDay?: number;
  epochDate?: string;
  accountIds: string[];
  autoAttachAccounts?: boolean;
  carryPolicy?: BudgetPlanCarryPolicy;
  poolEnabled?: boolean;
  withSuggestedLines?: boolean;
  suggestionAnswers?: BudgetSuggestionAnswers;
}

export const BUDGET_SUGGESTION_DETAILS = ['compact', 'balanced', 'detailed'] as const;
export const BUDGET_SUGGESTION_HOUSING = ['mortgage', 'rent', 'family', 'owned'] as const;
export const BUDGET_SUGGESTION_TRANSPORT = ['car', 'transit', 'bikeWalk', 'multiple'] as const;
export const BUDGET_SUGGESTION_PETS = ['none', 'dog', 'cat', 'other'] as const;
export const BUDGET_SUGGESTION_EATS_OUT = ['often', 'sometimes', 'rarely'] as const;
export const BUDGET_SUGGESTION_SUBSCRIPTIONS = ['many', 'few', 'none'] as const;
export const BUDGET_SUGGESTION_MAX_FOCUS_CATEGORIES = 20;

/** What the user told the setup questions; every answer is optional. */
export interface BudgetSuggestionAnswers {
  detail?: (typeof BUDGET_SUGGESTION_DETAILS)[number];
  housing?: (typeof BUDGET_SUGGESTION_HOUSING)[number];
  transport?: (typeof BUDGET_SUGGESTION_TRANSPORT)[number];
  pets?: (typeof BUDGET_SUGGESTION_PETS)[number];
  eatsOut?: (typeof BUDGET_SUGGESTION_EATS_OUT)[number];
  subscriptions?: (typeof BUDGET_SUGGESTION_SUBSCRIPTIONS)[number];
  focusCategoryIds?: string[];
}

export interface BudgetSuggestionContext {
  hasHistory: boolean;
  /** Top spending categories with history, a fixed starter set without; `monthlyAvg` is null without history. */
  categories: { id: string; monthlyAvg: number | null }[];
}

export interface AddSuggestedBudgetLinesResponse {
  created: number;
  /** No model was available, so the lines ignore the answers beyond the detail level. */
  answersIgnored?: boolean;
}
