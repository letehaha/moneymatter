import {
  ACCOUNT_TYPES,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_INTERVAL_LIMITS,
  SubscriptionMatchingRules,
  type SubscriptionRecurrence,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import * as Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import Subscriptions from '@models/subscriptions.model';
import Tags from '@models/tags.model';

/**
 * A monetary amount is meaningless without its currency, and the pay path treats
 * a null currency as "same as the account" (booking the raw figure unconverted).
 * So `expectedAmount` and `expectedCurrencyCode` must travel together: both set
 * or both null. Enforced in the service layer (the HTTP controllers check too,
 * but MCP callers reach the service directly). Pass the merged post-update
 * values; only their null-ness matters, so cents-vs-decimal is irrelevant here.
 */
export const assertAmountCurrencyConsistent = ({
  expectedAmount,
  expectedCurrencyCode,
}: {
  expectedAmount: Money | number | null | undefined;
  expectedCurrencyCode: string | null | undefined;
}): void => {
  const hasAmount = expectedAmount != null;
  const hasCurrency = expectedCurrencyCode != null;

  if (hasAmount !== hasCurrency) {
    throw new ValidationError({
      message: 'expectedAmount and expectedCurrencyCode must be provided together (both set, or both omitted).',
    });
  }
};

/**
 * Which recurrence rule a schedule breaks, as a backend i18n key plus the field at fault, or
 * null when it holds:
 * `custom` needs a complete step within its unit's limit, a preset carries no step.
 * Shared by the request schemas and the service-layer assert so both refuse alike.
 */
export const findRecurrenceProblem = ({
  frequency,
  intervalUnit,
  intervalCount,
}: Partial<SubscriptionRecurrence>): {
  key: string;
  field: 'intervalUnit' | 'intervalCount';
  variables?: Record<string, number>;
} | null => {
  if (frequency !== undefined && frequency !== SUBSCRIPTION_FREQUENCIES.custom) {
    if (intervalUnit == null && intervalCount == null) return null;
    return {
      key: 'subscriptions.validation.customInterval.presetConflict',
      field: intervalUnit != null ? 'intervalUnit' : 'intervalCount',
    };
  }
  if (frequency === SUBSCRIPTION_FREQUENCIES.custom && (intervalUnit == null || intervalCount == null)) {
    return {
      key: 'subscriptions.validation.customInterval.required',
      field: intervalUnit == null ? 'intervalUnit' : 'intervalCount',
    };
  }
  if (intervalUnit != null && intervalCount != null) {
    const max = SUBSCRIPTION_INTERVAL_LIMITS.max[intervalUnit];
    if (intervalCount < SUBSCRIPTION_INTERVAL_LIMITS.min || intervalCount > max) {
      return {
        key: 'subscriptions.validation.customInterval.countOutOfRange',
        field: 'intervalCount',
        variables: { min: SUBSCRIPTION_INTERVAL_LIMITS.min, max },
      };
    }
  }
  return null;
};

/**
 * Refuses a schedule that breaks a recurrence rule. Enforced in the service layer because
 * an update's merged state is only known there.
 */
export const assertRecurrenceConsistent = (recurrence: SubscriptionRecurrence): void => {
  const problem = findRecurrenceProblem(recurrence);
  if (problem) throw new ValidationError({ message: t({ key: problem.key, variables: problem.variables }) });
};

export const findSubscriptionOrThrow = async ({ id, userId }: { id: string; userId: number }) => {
  return findOrThrowNotFound({
    query: Subscriptions.findOne({ where: { id, userId } }),
    message: 'Subscription not found.',
  });
};

export const validateAccountOwnership = async ({ accountId, userId }: { accountId: string; userId: number }) => {
  await findOrThrowNotFound({
    query: Accounts.getAccountById({ userId, id: accountId }),
    message: 'Account not found or does not belong to user.',
  });
};

export const validateCategoryOwnership = async ({ categoryId, userId }: { categoryId: string; userId: number }) => {
  await findOrThrowNotFound({
    query: Categories.findOne({ where: { id: categoryId, userId } }),
    message: 'Category not found or does not belong to user.',
  });
};

export const validatePayeeOwnership = async ({ payeeId, userId }: { payeeId: string; userId: number }) => {
  await findOrThrowNotFound({
    query: Payees.findOne({ where: { id: payeeId, userId } }),
    message: t({ key: 'subscriptions.payeeNotFoundOrNotBelongToUser' }),
  });
};

export const validateTagsOwnership = async ({ tagIds, userId }: { tagIds: string[]; userId: number }) => {
  const uniqueTagIds = [...new Set(tagIds)];
  if (uniqueTagIds.length === 0) return;

  const ownedCount = await Tags.count({ where: { id: uniqueTagIds, userId } });
  if (ownedCount !== uniqueTagIds.length) {
    throw new ValidationError({ message: t({ key: 'subscriptions.tagsNotFoundOrNotBelongToUser' }) });
  }
};

/**
 * Auto-record hands `markPeriodPaid` the booking inputs every tick (CREATE mode
 * needs account + amount + currency). Without them the cron would throw on every
 * run. Matching rules and auto-record both produce a "settling" transaction for
 * the same period — auto-record on the dueDate, matching on the next bank
 * import — so allowing both leaves the user with a duplicate to clean up; reject
 * the pair at the boundary instead. Pass the merged post-update values so a
 * partial PATCH still validates against the eventual stored state. DB CHECK
 * constraints repeat both rules as defence-in-depth (MCP/SQL bypasses can't
 * smuggle past them).
 */
export const assertAutoRecordConsistent = ({
  autoRecord,
  accountId,
  expectedAmount,
  expectedCurrencyCode,
  matchingRules,
}: {
  autoRecord: boolean;
  accountId: string | null | undefined;
  expectedAmount: Money | number | null | undefined;
  expectedCurrencyCode: string | null | undefined;
  matchingRules: SubscriptionMatchingRules | null | undefined;
}): void => {
  if (!autoRecord) return;

  if (accountId == null) {
    throw new ValidationError({
      message: t({ key: 'subscriptions.validation.autoRecord.requiresAccount' }),
    });
  }
  if (expectedAmount == null || expectedCurrencyCode == null) {
    throw new ValidationError({
      message: t({ key: 'subscriptions.validation.autoRecord.requiresAmount' }),
    });
  }
  if ((matchingRules?.rules?.length ?? 0) > 0) {
    throw new ValidationError({
      message: t({ key: 'subscriptions.validation.autoRecord.excludesMatching' }),
    });
  }
};

export const assertAutoRecordAccountIsManual = async ({
  autoRecord,
  accountId,
  userId,
}: {
  autoRecord: boolean;
  accountId: string | null | undefined;
  userId: number;
}): Promise<void> => {
  if (!autoRecord || accountId == null) return;

  const account = await Accounts.getAccountById({ userId, id: accountId });
  if (account && account.type !== ACCOUNT_TYPES.system) {
    throw new ValidationError({ message: t({ key: 'transactions.manualOnConnectedAccount' }) });
  }
};
