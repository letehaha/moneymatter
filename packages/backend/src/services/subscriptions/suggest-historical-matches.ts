import { SUBSCRIPTION_LINK_STATUS, SubscriptionMatchingRule } from '@bt/shared/types';
import { Money } from '@common/types/money';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import { findTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { startOfDay, subMonths } from 'date-fns';
import { Op, WhereOptions } from 'sequelize';

import { findSubscriptionOrThrow } from './helpers';

const HISTORICAL_MONTHS = 12;
const MAX_SUGGESTIONS = 100;
const CROSS_CURRENCY_TOLERANCE = 0.05; // 5% tolerance for cross-currency matching

export const suggestHistoricalMatches = async ({
  subscriptionId,
  userId,
}: {
  subscriptionId: string;
  userId: number;
}) => {
  const subscription = await findSubscriptionOrThrow({ id: subscriptionId, userId });

  const { matchingRules } = subscription;
  if (!matchingRules?.rules?.length) {
    return [];
  }

  // Snap to start-of-day so the cutoff doesn't slide with wall-clock time —
  // otherwise a transaction drops out of suggestions partway through the day.
  const cutoffDate = startOfDay(subMonths(new Date(), HISTORICAL_MONTHS));

  // Separate rules into SQL-applicable and post-processing rules
  // NOTE: This builds Sequelize WHERE clauses for the same rule types that
  // matching-engine.ts evaluates at runtime via `evaluateRule`. Keep in sync.
  const { sqlConditions, crossCurrencyAmountRules } = buildWhereFromRules({
    rules: matchingRules.rules,
  });

  // If no SQL conditions and no cross-currency rules, nothing to match
  if (sqlConditions.length === 0 && crossCurrencyAmountRules.length === 0) {
    return [];
  }

  // Only active links are excluded, so an unlinked transaction can be suggested again.
  const excludedIds = (
    await SubscriptionTransactions.findAll({
      attributes: ['transactionId'],
      where: { subscriptionId, status: SUBSCRIPTION_LINK_STATUS.active },
    })
  ).map((l) => l.transactionId);

  const baseWhere: WhereOptions = {
    time: { [Op.gte]: cutoffDate },
    transactionType: subscription.transactionType,
    paymentParentId: null,
    ...(sqlConditions.length > 0 && { [Op.and]: sqlConditions }),
    ...(excludedIds.length > 0 && { id: { [Op.notIn]: excludedIds } }),
    ...(subscription.accountId && { accountId: subscription.accountId }),
  };

  // Fetch more transactions if we need to post-filter by cross-currency amount
  // We fetch more because some will be filtered out after conversion
  const fetchLimit = crossCurrencyAmountRules.length > 0 ? MAX_SUGGESTIONS * 3 : MAX_SUGGESTIONS;

  let transactions = await findTransactions({
    planned: 'exclude',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: { cap: { limit: fetchLimit, onTruncated: 'log', context: { userId, subscriptionId } } },
    where: baseWhere,
    order: [['time', 'DESC']],
  });

  // Apply cross-currency amount filtering in memory
  if (crossCurrencyAmountRules.length > 0 && transactions.length > 0) {
    transactions = await filterByCrossCurrencyAmount({
      transactions,
      rules: crossCurrencyAmountRules,
      userId,
    });
  }

  // Limit to MAX_SUGGESTIONS after filtering
  return serializeTransactions(transactions.slice(0, MAX_SUGGESTIONS));
};

interface AmountRuleWithCurrency {
  minCents: number;
  maxCents: number;
  currencyCode: string;
}

interface BuildWhereResult {
  sqlConditions: WhereOptions[];
  crossCurrencyAmountRules: AmountRuleWithCurrency[];
}

function buildWhereFromRules({ rules }: { rules: SubscriptionMatchingRule[] }): BuildWhereResult {
  const sqlConditions: WhereOptions[] = [];
  const crossCurrencyAmountRules: AmountRuleWithCurrency[] = [];

  for (const rule of rules) {
    switch (rule.field) {
      case 'note': {
        if (rule.operator === 'contains_any' && Array.isArray(rule.value)) {
          const patterns = (rule.value as string[]).map((v) => ({
            [Op.iLike]: `%${v}%`,
          }));
          sqlConditions.push({ note: { [Op.or]: patterns } });
        }
        break;
      }
      case 'amount': {
        if (rule.operator === 'between' && typeof rule.value === 'object' && !Array.isArray(rule.value)) {
          const { min, max } = rule.value as { min: number; max: number };
          // Rule bounds are decimals; the `amount` column and the tolerance math below are cents.
          const minCents = Money.fromDecimal(min).toCents();
          const maxCents = Money.fromDecimal(max).toCents();

          if (rule.currencyCode) {
            // Cross-currency amount rules need post-processing
            crossCurrencyAmountRules.push({
              minCents,
              maxCents,
              currencyCode: rule.currencyCode,
            });
          } else {
            // Same-currency amount rules can use SQL
            sqlConditions.push({
              amount: { [Op.between]: [minCents, maxCents] },
            });
          }
        }
        break;
      }
      case 'transactionType': {
        if (rule.operator === 'equals') {
          sqlConditions.push({ transactionType: rule.value as string });
        }
        break;
      }
      case 'accountId': {
        if (rule.operator === 'equals') {
          sqlConditions.push({ accountId: rule.value as string });
        }
        break;
      }
    }
  }

  return { sqlConditions, crossCurrencyAmountRules };
}

/**
 * Filter transactions by cross-currency amount rules.
 * Converts each transaction's amount to the rule's currency and checks if it falls within the range.
 * Uses the same tolerance (5%) as matching-engine.ts for consistency.
 */
async function filterByCrossCurrencyAmount({
  transactions,
  rules,
  userId,
}: {
  transactions: Transactions[];
  rules: AmountRuleWithCurrency[];
  userId: number;
}): Promise<Transactions[]> {
  const results: Transactions[] = [];

  for (const tx of transactions) {
    let matchesAllRules = true;

    for (const rule of rules) {
      let amount = tx.amount.abs();

      // If currencies match, compare directly
      if (tx.currencyCode === rule.currencyCode) {
        const amountCents = amount.toCents();
        if (amountCents < rule.minCents || amountCents > rule.maxCents) {
          matchesAllRules = false;
          break;
        }
        continue;
      }

      // Cross-currency: convert transaction amount to rule's currency
      try {
        const converted = await calculateRefAmount({
          amount,
          userId,
          date: tx.time,
          baseCode: tx.currencyCode,
          quoteCode: rule.currencyCode,
        });
        amount = converted;
      } catch {
        // If conversion fails, rule doesn't match
        matchesAllRules = false;
        break;
      }

      // Apply tolerance (same as matching-engine.ts)
      const tolerantMin = Math.floor(rule.minCents * (1 - CROSS_CURRENCY_TOLERANCE));
      const tolerantMax = Math.ceil(rule.maxCents * (1 + CROSS_CURRENCY_TOLERANCE));
      const amountCents = amount.toCents();
      if (amountCents < tolerantMin || amountCents > tolerantMax) {
        matchesAllRules = false;
        break;
      }
    }

    if (matchesAllRules) {
      results.push(tx);
    }
  }

  return results;
}
