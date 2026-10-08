import type { EntityLogoFields, LogoResolutionState } from './entity-logo';
import type { RecordId } from './record-id';
import type { TRANSACTION_TYPES } from './transactions';

/**
 * Subscription types
 */
export enum SUBSCRIPTION_TYPES {
  subscription = 'subscription',
  bill = 'bill',
  installment = 'installment',
}

/**
 * Subscription frequency presets
 */
export enum SUBSCRIPTION_FREQUENCIES {
  weekly = 'weekly',
  biweekly = 'biweekly',
  monthly = 'monthly',
  quarterly = 'quarterly',
  semiAnnual = 'semi_annual',
  annual = 'annual',
}

/**
 * Source of how a transaction was linked to a subscription
 */
export enum SUBSCRIPTION_MATCH_SOURCE {
  manual = 'manual',
  rule = 'rule',
  ai = 'ai',
}

/**
 * Status of a subscription–transaction link
 */
export enum SUBSCRIPTION_LINK_STATUS {
  active = 'active',
  unlinked = 'unlinked',
}

/**
 * Status of a subscription candidate (auto-detected recurring pattern)
 */
export enum SUBSCRIPTION_CANDIDATE_STATUS {
  pending = 'pending',
  accepted = 'accepted',
  dismissed = 'dismissed',
}

/**
 * Subscription period statuses.
 * Stored as VARCHAR(50) in the DB – not a Postgres ENUM.
 */
export enum SUBSCRIPTION_PERIOD_STATUSES {
  upcoming = 'upcoming',
  paid = 'paid',
  overdue = 'overdue',
  skipped = 'skipped',
}

export type SubscriptionPeriodStatus = `${SUBSCRIPTION_PERIOD_STATUSES}`;

/**
 * Fixed "remind before" presets for payment reminders.
 * Up to 3 can be selected per reminder.
 *
 * `onDueDate` (0 days) fires ON the due date itself rather than ahead of it –
 * for bills that arrive and are due the same day (e.g. an internet bill dated
 * the 4th that the user wants to be reminded about on the 4th).
 */
export const REMIND_BEFORE_PRESETS = {
  onDueDate: '0_days',
  oneDay: '1_day',
  twoDays: '2_days',
  threeDays: '3_days',
  fiveDays: '5_days',
  oneWeek: '1_week',
  twoWeeks: '2_weeks',
  oneMonth: '1_month',
} as const;

export type RemindBeforePreset = (typeof REMIND_BEFORE_PRESETS)[keyof typeof REMIND_BEFORE_PRESETS];

/** Map presets to number of days for calculation */
export const REMIND_BEFORE_DAYS: Record<RemindBeforePreset, number> = {
  '0_days': 0,
  '1_day': 1,
  '2_days': 2,
  '3_days': 3,
  '5_days': 5,
  '1_week': 7,
  '2_weeks': 14,
  '1_month': 30,
};

/** Maximum number of remind-before presets per reminder */
export const MAX_REMIND_BEFORE_PRESETS = 3;

/**
 * Matching rule for subscription auto-matching.
 * Rules are evaluated with AND logic (all must pass).
 */
export interface SubscriptionMatchingRule {
  field: 'note' | 'amount' | 'transactionType' | 'accountId';
  operator: 'contains_any' | 'between' | 'equals';
  value: string[] | { min: number; max: number } | string | number;
  /** Currency code for amount rules (enables cross-currency matching) */
  currencyCode?: string;
}

export interface SubscriptionMatchingRules {
  rules: SubscriptionMatchingRule[];
}

export interface SubscriptionModel extends EntityLogoFields {
  id: RecordId;
  userId: number;
  name: string;
  type: SUBSCRIPTION_TYPES;
  transactionType: TRANSACTION_TYPES;
  /** Expected billed amount as a decimal (e.g. 9.99). Persisted as cents internally. */
  expectedAmount: number | null;
  expectedCurrencyCode: string | null;
  frequency: SUBSCRIPTION_FREQUENCIES;
  startDate: string;
  endDate: string | null;
  accountId: RecordId | null;
  categoryId: RecordId | null;
  /** Payee stamped onto transactions matched or booked by this subscription,
   *  unless the transaction already carries a payee or the user locked it. */
  payeeId: RecordId | null;
  /** Tags merged (add-only) onto transactions matched or booked by this
   *  subscription. Optional because it is an association, so responses that
   *  return a bare subscription row omit it. */
  tagIds?: RecordId[];
  matchingRules: SubscriptionMatchingRules;
  isActive: boolean;
  notes: string | null;
  /** Rolling next payment date. Null until a period-payment schedule is configured. */
  dueDate: string | null;
  /** Day-of-month (1-31) preserved from the initial dueDate for month-end clamping. */
  anchorDay: number | null;
  /** Installment cap: stop generating periods after this many. Null = indefinite. */
  maxOccurrences: number | null;
  /** When an installment consumed its full schedule it is marked finished here and
   *  deactivated. Null for open installments and for subscriptions/bills, which never
   *  complete. Distinguishes a finished installment from a manually paused one (both
   *  carry isActive=false). */
  completedAt: Date | null;
  /** Whether this subscription appears in the dashboard "Subscriptions & Bills" widget. */
  showInWidget: boolean;
  /** When true, the hourly auto-record cron books the expense for the next due
   *  period and marks it paid. Requires accountId + expectedAmount + expectedCurrencyCode.
   *  Mutually exclusive with `matchingRules.rules` (both routes would race). */
  autoRecord: boolean;
  /** JSONB array of RemindBeforePreset strings. Empty array means no advance notifications. */
  remindBefore: RemindBeforePreset[];
  notifyEmail: boolean;
  /** How logoDomain was resolved – see LogoResolutionState. 'manual' can pair
   *  with a null logoDomain (user explicitly cleared the logo); null only before
   *  the subscription has been through a resolution pass. */
  logoSource: LogoResolutionState;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionPeriodModel {
  id: RecordId;
  subscriptionId: RecordId;
  dueDate: string;
  status: SubscriptionPeriodStatus;
  paidAt: Date | null;
  transactionId: RecordId | null;
  /** True when `transactionId` was generated by the app (CREATE-mode pay) vs. linked by the user. */
  transactionAutoCreated: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionPeriodNotificationModel {
  id: RecordId;
  periodId: RecordId;
  remindBeforePreset: RemindBeforePreset;
  sentAt: Date;
  emailSent: boolean;
  emailError: string | null;
}
