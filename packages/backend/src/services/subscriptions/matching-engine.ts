import { CATEGORIZATION_SOURCE, SUBSCRIPTION_MATCH_SOURCE, SubscriptionMatchingRule } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import * as Transactions from '@models/transactions.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';

import { settleNearestOpenPeriod } from './settle-period-on-match';
import { stampSubscriptionPayeeAndTags } from './stamp-payee-and-tags';

interface MatchTransactionParams {
  transaction: Transactions.default;
  userId: number;
  /** Link and settle, but leave the row's category as it is. */
  preserveCategory?: boolean;
}

interface EvaluateRuleParams {
  rule: SubscriptionMatchingRule;
  transaction: Transactions.default;
  userId: number;
}

/**
 * Evaluates a single transaction against all active subscriptions for a user.
 * Collects all matching subscriptions, scores them by amount closeness, and
 * links the best match. Returns the matched subscription or null.
 */
export const matchTransactionToSubscriptions = withTransaction(
  async ({ transaction, userId, preserveCategory = false }: MatchTransactionParams): Promise<Subscriptions | null> => {
    // Check if already linked (active) or previously unlinked (don't re-match)
    const existingLink = await SubscriptionTransactions.findOne({
      where: { transactionId: transaction.id },
    });
    if (existingLink) return null;

    const subscriptions = await Subscriptions.findAll({
      where: { userId, isActive: true },
    });

    // Collect all matching subscriptions with their scores
    const candidates: { subscription: Subscriptions; score: number }[] = [];

    for (const subscription of subscriptions) {
      // If subscription has a different transactionType than the transaction, skip
      if (subscription.transactionType !== transaction.transactionType) {
        continue;
      }

      // If subscription is scoped to an account, skip if transaction is from a different account
      if (subscription.accountId && subscription.accountId !== transaction.accountId) {
        continue;
      }

      const rules = subscription.matchingRules?.rules;
      if (!rules || rules.length === 0) continue;

      // Short-circuit: stop evaluating rules as soon as one fails (avoids unnecessary async work)
      // NOTE: These rule evaluations correspond to the Sequelize WHERE clauses in
      // suggest-historical-matches.ts `buildWhereFromRules`. Keep in sync.
      let allMatch = true;
      for (const rule of rules) {
        if (!(await evaluateRule({ rule, transaction, userId }))) {
          allMatch = false;
          break;
        }
      }

      if (!allMatch) continue;

      // Calculate score based on amount closeness to expectedAmount
      const score = await calculateMatchScore({ subscription, transaction, userId });
      candidates.push({ subscription, score });
    }

    if (candidates.length === 0) return null;

    // Sort by score descending — best match first
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0]!;

    // Link the best match
    await SubscriptionTransactions.create({
      subscriptionId: best.subscription.id,
      transactionId: transaction.id,
      matchSource: SUBSCRIPTION_MATCH_SOURCE.rule,
    });

    // On a planned row the user picked the category, payee and tags on purpose, so the
    // match only records the link.
    if (transaction.isPlanned) {
      logger.info(
        `Subscription "${best.subscription.name}" linked planned transaction ${transaction.id} (score: ${best.score.toFixed(3)}, candidates: ${candidates.length})`,
      );
      return best.subscription;
    }

    // Apply category if subscription has one
    if (best.subscription.categoryId && !preserveCategory) {
      await Transactions.updateTransactionById({
        id: transaction.id,
        userId,
        categoryId: best.subscription.categoryId,
        categorizationMeta: {
          source: CATEGORIZATION_SOURCE.subscriptionRule,
          subscriptionId: best.subscription.id,
          categorizedAt: new Date().toISOString(),
        },
      });
    }

    await stampSubscriptionPayeeAndTags({ subscription: best.subscription, transactionIds: [transaction.id] });

    // The link alone leaves a scheduled subscription's period looking unpaid or overdue, so
    // settle the open period this payment belongs to.
    await settleNearestOpenPeriod({
      subscription: best.subscription,
      transactionId: transaction.id,
      transactionTime: transaction.time,
      userId,
    });

    logger.info(
      `Subscription "${best.subscription.name}" matched transaction ${transaction.id} (score: ${best.score.toFixed(3)}, candidates: ${candidates.length})`,
    );
    return best.subscription;
  },
);

/**
 * Calculates a match score for a subscription-transaction pair.
 * Higher score = better match.
 *
 * - If subscription has expectedAmount + expectedCurrencyCode:
 *   score = 1 - abs(convertedTxAmount - expectedAmount) / expectedAmount
 * - Otherwise: score = 0 (lowest priority)
 */
async function calculateMatchScore({
  subscription,
  transaction,
  userId,
}: {
  subscription: Subscriptions;
  transaction: Transactions.default;
  userId: number;
}): Promise<number> {
  // A zero expected amount can't anchor a deviation ratio (division by zero), so
  // treat it like a missing amount and skip scoring.
  if (
    subscription.expectedAmount == null ||
    subscription.expectedAmount.toCents() === 0 ||
    !subscription.expectedCurrencyCode
  ) {
    return 0;
  }

  // Capture before the currency-conversion await; a property read can't stay
  // narrowed to non-null across it.
  const expected = subscription.expectedAmount;

  let txAmountInSubCurrency: Money;

  if (transaction.currencyCode === subscription.expectedCurrencyCode) {
    txAmountInSubCurrency = transaction.amount.abs();
  } else {
    try {
      const converted = await calculateRefAmount({
        amount: transaction.amount.abs(),
        userId,
        date: transaction.time,
        baseCode: transaction.currencyCode,
        quoteCode: subscription.expectedCurrencyCode,
      });
      txAmountInSubCurrency = converted;
    } catch {
      // If conversion fails, give a neutral score
      return 0;
    }
  }

  const deviation = txAmountInSubCurrency.subtract(expected).abs().toNumber() / expected.toNumber();

  // score = 1 - deviation, clamped to [0, 1]
  return Math.max(0, 1 - deviation);
}

async function evaluateRule({ rule, transaction, userId }: EvaluateRuleParams): Promise<boolean> {
  switch (rule.field) {
    case 'note': {
      if (rule.operator !== 'contains_any' || !Array.isArray(rule.value)) return false;
      const note = (transaction.note || '').toLowerCase();
      return (rule.value as string[]).some((v) => note.includes(v.toLowerCase()));
    }
    case 'amount': {
      if (rule.operator !== 'between' || typeof rule.value !== 'object' || Array.isArray(rule.value)) return false;
      const { min, max } = rule.value as { min: number; max: number };
      // Rule bounds are decimals (the unit the API speaks); comparisons run in cents.
      const minCents = Money.fromDecimal(min).toCents();
      const maxCents = Money.fromDecimal(max).toCents();
      let amount = transaction.amount.abs();

      // If currencies match or no currency specified, compare directly
      if (!rule.currencyCode || rule.currencyCode === transaction.currencyCode) {
        const amountCents = amount.toCents();
        return amountCents >= minCents && amountCents <= maxCents;
      }

      // Cross-currency: convert transaction amount to rule's currency, then compare with ±5% tolerance
      try {
        const converted = await calculateRefAmount({
          amount,
          userId,
          date: transaction.time,
          baseCode: transaction.currencyCode,
          quoteCode: rule.currencyCode,
        });
        amount = converted;
      } catch {
        // If conversion fails, rule doesn't match
        return false;
      }

      const tolerance = 0.05;
      const tolerantMin = Math.floor(minCents * (1 - tolerance));
      const tolerantMax = Math.ceil(maxCents * (1 + tolerance));
      const amountCents = amount.toCents();
      return amountCents >= tolerantMin && amountCents <= tolerantMax;
    }
    case 'transactionType': {
      if (rule.operator !== 'equals') return false;
      return transaction.transactionType === rule.value;
    }
    case 'accountId': {
      if (rule.operator !== 'equals') return false;
      return transaction.accountId === rule.value;
    }
    default:
      return false;
  }
}
