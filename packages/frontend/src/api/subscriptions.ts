import { api } from '@/api/_api';
import type {
  RecordId,
  RemindBeforePreset,
  SubscriptionModel,
  SubscriptionPeriodModel,
  TransactionModel,
} from '@bt/shared/types';

/** Minimal open-period shape the list exposes for the "Due in N days" chip + quick pay. */
export interface SubscriptionListCurrentPeriod {
  id: string;
  dueDate: string;
  status: SubscriptionPeriodModel['status'];
}

export interface SubscriptionListItem extends SubscriptionModel {
  linkedTransactionsCount: number;
  /** Earliest open (upcoming or overdue) period, or null for detection-only subscriptions. */
  currentPeriod: SubscriptionListCurrentPeriod | null;
  /**
   * Effective next occurrence (YYYY-MM-DD): the open period's dueDate when one exists,
   * otherwise a derived future date. Present even when `currentPeriod` is null, so the
   * "in N days" chip renders for every item. Null only when no date can be derived.
   */
  nextDueDate: string | null;
  /** Count of paid periods. With `maxOccurrences` it renders "N of M paid" progress on the card. */
  paidPeriodsCount: number;
  account?: { id: string; name: string; currencyCode: string } | null;
  category?: { id: string; name: string; color: string; icon: string | null } | null;
}

export interface SubscriptionDetail extends SubscriptionModel {
  nextExpectedDate: string | null;
  periods: SubscriptionPeriodModel[];
  /** The detail endpoint always includes the tag association, unlike bare subscription rows. */
  tagIds: NonNullable<SubscriptionModel['tagIds']>;
  account?: { id: string; name: string; currencyCode: string } | null;
  category?: { id: string; name: string; color: string; icon: string | null } | null;
  transactions?: Array<
    TransactionModel & {
      SubscriptionTransactions: {
        matchSource: string;
        matchedAt: string;
      };
    }
  >;
}

export const loadSubscriptions = async ({
  isActive,
  type,
  sortBy,
}: {
  isActive?: boolean;
  type?: string;
  sortBy?: string;
} = {}): Promise<SubscriptionListItem[]> => {
  const query: Record<string, string> = {};
  if (isActive !== undefined) query.isActive = String(isActive);
  if (type) query.type = type;
  if (sortBy) query.sortBy = sortBy;

  return api.get('/subscriptions', query);
};

export const loadSubscriptionById = async ({ id }: { id: string }): Promise<SubscriptionDetail> => {
  return api.get(`/subscriptions/${id}`);
};

export const createSubscription = async (
  payload: Partial<Omit<SubscriptionModel, 'id' | 'userId' | 'createdAt' | 'updatedAt'>> &
    Pick<SubscriptionModel, 'name' | 'frequency' | 'startDate'> & {
      dueDate?: string | null;
      maxOccurrences?: number | null;
      remindBefore?: RemindBeforePreset[];
      notifyEmail?: boolean;
    },
): Promise<SubscriptionModel> => {
  return api.post('/subscriptions', payload);
};

export const updateSubscription = async ({
  id,
  payload,
}: {
  id: string;
  payload: Partial<Omit<SubscriptionModel, 'id' | 'userId' | 'createdAt' | 'updatedAt'>> & {
    dueDate?: string | null;
    maxOccurrences?: number | null;
    remindBefore?: RemindBeforePreset[];
    notifyEmail?: boolean;
  };
}): Promise<SubscriptionModel> => {
  return api.put(`/subscriptions/${id}`, payload);
};

export const deleteSubscription = async ({ id }: { id: string }) => {
  return api.delete(`/subscriptions/${id}`);
};

export const toggleSubscriptionActive = async ({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}): Promise<SubscriptionModel> => {
  return api.patch(`/subscriptions/${id}/toggle-active`, { isActive });
};

export const resetSubscriptionLogo = async ({ id }: { id: string }): Promise<SubscriptionModel> => {
  return api.post(`/subscriptions/${id}/reset-logo`, {});
};

export const linkTransactionsToSubscription = async ({
  id,
  transactionIds,
}: {
  id: string;
  transactionIds: string[];
}): Promise<{ linked: number }> => {
  return api.post(`/subscriptions/${id}/transactions`, { transactionIds });
};

export const unlinkTransactionsFromSubscription = async ({
  id,
  transactionIds,
}: {
  id: string;
  transactionIds: string[];
}): Promise<{ unlinked: number }> => {
  return api.delete(`/subscriptions/${id}/transactions`, {
    data: { transactionIds },
  });
};

export const loadSuggestedMatches = async ({ id }: { id: string }): Promise<TransactionModel[]> => {
  return api.get(`/subscriptions/${id}/suggest-matches`);
};

export const INCOME_LOOKBACK_MONTHS_OPTIONS = [1, 3, 6, 12] as const;
export type IncomeLookbackMonths = (typeof INCOME_LOOKBACK_MONTHS_OPTIONS)[number];
export const DEFAULT_INCOME_LOOKBACK_MONTHS: IncomeLookbackMonths = 6;

interface SubscriptionsSummary {
  estimatedMonthlyCost: number;
  projectedYearlyCost: number;
  expectedMonthlyIncome: number;
  activeCount: { expense: number; income: number };
  currencyCode: string;
  averageMonthlyIncome: number;
  percentOfIncome: number | null;
  lookbackMonths: IncomeLookbackMonths;
}

export const loadSubscriptionsSummary = async ({
  type,
  lookbackMonths,
}: {
  type?: string;
  lookbackMonths?: IncomeLookbackMonths;
} = {}): Promise<SubscriptionsSummary> => {
  const query: Record<string, string> = {};
  if (type) query.type = type;
  if (lookbackMonths !== undefined) query.lookbackMonths = String(lookbackMonths);

  return api.get('/subscriptions/summary', query);
};

export interface SubscriptionPayPreview {
  /** True when the subscription's billed currency differs from its account's currency. */
  isCrossCurrency: boolean;
  /** ISO code the booked expense will be denominated in (the account's currency), or null when no account is linked. */
  accountCurrencyCode: string | null;
  /** ISO code the subscription is billed in. */
  subscriptionCurrencyCode: string | null;
  /** Billed amount in the subscription's own currency, or null for a variable-amount subscription. */
  expectedAmount: number | null;
  /** Billed amount converted into the account currency at today's rate, used to pre-fill the pay dialog. */
  convertedAmount: number | null;
  /** Linked transactions inside the requested period that back no period yet, nearest to due date first. */
  linkedPayments: LinkedPaymentCandidate[];
}

export interface LinkedPaymentCandidate {
  id: RecordId;
  amount: number;
  currencyCode: string;
  time: string;
  note: string | null;
  payeeName: string | null;
  accountId: RecordId;
}

export const markSubscriptionPeriodPaid = async ({
  id,
  periodId,
  transactionId,
  notes,
  createTransaction,
  amount,
  time,
  accountId,
}: {
  id: string;
  periodId: string;
  transactionId?: string | null;
  notes?: string | null;
  /** Generate the expense transaction from the subscription. Mutually exclusive with transactionId. */
  createTransaction?: boolean;
  /** Decimal amount override for the generated transaction. Falls back to the subscription's expectedAmount. */
  amount?: number;
  /** Actual payment date for the generated transaction. Falls back to now. */
  time?: Date;
  /**
   * Account to book the generated transaction against. When supplied it is also
   * linked to the subscription, so future payments reuse it. Used by the pay-time
   * "create a transaction" flow for account-less subscriptions.
   */
  accountId?: string | null;
}): Promise<SubscriptionPeriodModel> => {
  const payload: Record<string, unknown> = {};
  if (transactionId !== undefined) payload.transactionId = transactionId;
  if (notes !== undefined) payload.notes = notes;
  if (createTransaction !== undefined) payload.createTransaction = createTransaction;
  if (amount !== undefined) payload.amount = amount;
  if (time !== undefined) payload.time = time.toISOString();
  if (accountId !== undefined) payload.accountId = accountId;

  return api.post(`/subscriptions/${id}/periods/${periodId}/pay`, Object.keys(payload).length ? payload : undefined);
};

export const skipSubscriptionPeriod = async ({
  id,
  periodId,
}: {
  id: string;
  periodId: string;
}): Promise<SubscriptionPeriodModel> => {
  return api.post(`/subscriptions/${id}/periods/${periodId}/skip`);
};

export const unlinkSubscriptionPeriodTransaction = async ({
  id,
  periodId,
}: {
  id: string;
  periodId: string;
}): Promise<SubscriptionPeriodModel> => {
  return api.post(`/subscriptions/${id}/periods/${periodId}/unlink`);
};

export const revertSubscriptionPeriod = async ({
  id,
  periodId,
}: {
  id: string;
  periodId: string;
}): Promise<SubscriptionPeriodModel> => {
  return api.post(`/subscriptions/${id}/periods/${periodId}/revert`);
};

export const getSubscriptionPayPreview = async ({
  id,
  periodId,
}: {
  id: string;
  periodId?: string;
}): Promise<SubscriptionPayPreview> => {
  return api.get(`/subscriptions/${id}/pay-preview`, { periodId });
};
