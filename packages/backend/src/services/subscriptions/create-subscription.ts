import {
  type EntityLogoPayload,
  RemindBeforePreset,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_TYPES,
  TRANSACTION_TYPES,
  SubscriptionMatchingRules,
} from '@bt/shared/types';
import { Money, centsToApiDecimalOrNull } from '@common/types/money';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Subscriptions from '@models/subscriptions.model';
import { enqueueLogoResolutionAfterCommit, resolveManualLogoFields } from '@services/brand-logos';
import { withTransaction } from '@services/common/with-transaction';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';

import {
  assertAmountCurrencyConsistent,
  assertAutoRecordAccountIsManual,
  assertAutoRecordConsistent,
  validateAccountOwnership,
  validateCategoryOwnership,
  validatePayeeOwnership,
  validateTagsOwnership,
} from './helpers';
import { assertInstallmentScheduleComplete } from './installments';
import { resolveOpenPeriodStatus } from './resolve-period-status';

interface CreateSubscriptionParams extends EntityLogoPayload {
  userId: number;
  name: string;
  type?: SUBSCRIPTION_TYPES;
  transactionType?: TRANSACTION_TYPES;
  expectedAmount?: number | null;
  expectedCurrencyCode?: string | null;
  frequency: SUBSCRIPTION_FREQUENCIES;
  startDate: string;
  endDate?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  payeeId?: string | null;
  tagIds?: string[];
  matchingRules?: SubscriptionMatchingRules;
  notes?: string | null;
  dueDate?: string | null;
  maxOccurrences?: number | null;
  remindBefore?: RemindBeforePreset[];
  notifyEmail?: boolean;
  autoRecord?: boolean;
}

export const createSubscription = withTransaction(
  async ({
    userId,
    accountId = null,
    categoryId = null,
    payeeId = null,
    tagIds = [],
    matchingRules = { rules: [] },
    expectedAmount = null,
    expectedCurrencyCode = null,
    endDate = null,
    notes = null,
    dueDate = null,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    ...rest
  }: CreateSubscriptionParams) => {
    if (accountId) {
      await validateAccountOwnership({ accountId, userId });
    }

    if (categoryId) {
      await validateCategoryOwnership({ categoryId, userId });
    }

    if (payeeId) {
      await validatePayeeOwnership({ payeeId, userId });
    }

    const uniqueTagIds = [...new Set(tagIds)];
    await validateTagsOwnership({ tagIds: uniqueTagIds, userId });

    // Enforce the installment invariant here too (not just in the controller) so MCP
    // callers, which reach the service directly, fail cleanly rather than on the DB CHECK.
    assertInstallmentScheduleComplete({
      type: rest.type ?? SUBSCRIPTION_TYPES.subscription,
      maxOccurrences: rest.maxOccurrences,
      dueDate,
    });

    // Amount and currency must travel together (covers MCP callers that bypass the
    // controller's request schema).
    assertAmountCurrencyConsistent({ expectedAmount, expectedCurrencyCode });

    // Auto-record needs booking inputs and is mutually exclusive with matching
    // rules — assert against the resolved post-default values so MCP callers
    // hit the same gate as HTTP callers.
    assertAutoRecordConsistent({
      autoRecord: rest.autoRecord ?? false,
      accountId,
      expectedAmount,
      expectedCurrencyCode,
      matchingRules,
    });
    await assertAutoRecordAccountIsManual({ autoRecord: rest.autoRecord ?? false, accountId, userId });

    // The subscriptions summary converts expectedAmount into the user's base
    // currency, and that conversion requires a UsersCurrencies row for the
    // subscription's currency. Connect it here (idempotent) so a subscription
    // in a never-used currency doesn't fail conversion later. Lives in the
    // service so MCP callers get the same guarantee as HTTP ones.
    if (expectedCurrencyCode) {
      await ensureUserCurrencyConnected({ userId, currencyCode: expectedCurrencyCode });
    }

    // Derive the calendar day from dueDate so recurring logic can anchor
    // future periods to the same day-of-month without reparsing the date.
    const anchorDay = dueDate ? new Date(dueDate + 'T00:00:00Z').getUTCDate() : null;

    // The API exchanges decimals; the cents-backed column takes a Money directly.
    const expectedAmountMoney = expectedAmount != null ? Money.fromDecimal(expectedAmount) : null;

    const subscription = await Subscriptions.create({
      userId,
      accountId,
      categoryId,
      payeeId,
      matchingRules,
      expectedAmount: expectedAmountMoney,
      expectedCurrencyCode,
      endDate,
      notes,
      dueDate,
      anchorDay,
      ...rest,
      // A supplied logo value is a manual override (`logoSource: 'manual'` makes
      // the resolver treat it as authoritative); null keys on create change
      // nothing, so they resolve to no writes and the resolver stays in charge.
      ...resolveManualLogoFields({ input: { logoDomain, logoInitials, logoColor, logoIcon } }),
    });

    if (uniqueTagIds.length > 0) {
      await subscription.$set('tags', uniqueTagIds);
    }

    // When a dueDate is provided, create the first period so the subscription
    // immediately has a trackable payment target. A past dueDate is born overdue
    // (mirrors the cron) instead of showing "in -1 days" until the next cron tick.
    if (dueDate) {
      await SubscriptionPeriods.create({
        subscriptionId: subscription.id,
        dueDate,
        status: resolveOpenPeriodStatus({ dueDate }),
      });
    }

    // Always enqueue: the resolver no-ops on `logoSource: 'manual'` rows, so a
    // manual logo is never clobbered. Deferred to afterCommit so the worker only
    // sees a committed row.
    enqueueLogoResolutionAfterCommit({ entity: 'subscription', id: subscription.id });

    // Surface expectedAmount as a decimal so the response matches GET (the
    // column holds raw cents).
    const plain = subscription.toJSON() as Subscriptions;
    return {
      ...plain,
      expectedAmount: centsToApiDecimalOrNull(plain.expectedAmount),
      tagIds: uniqueTagIds,
    };
  },
);
