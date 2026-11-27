import type { RecordId } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { trackAutomationApplied } from '@js/utils/posthog';
import { connection } from '@models/connection';
import TransactionAutomations from '@models/transaction-automations.model';
import * as Transactions from '@models/transactions.model';
import { withTransaction } from '@services/common/with-transaction';

import { applyActions } from './apply-actions';
import { buildAutomationContext, createLiveResolvers } from './build-context';
import { evaluateConditions } from './evaluate-conditions';
import { type AutomationRef, findMissingAutomationRef, missingReferencePatch } from './references';

/**
 * `transaction: null` keeps this off the ambient sync transaction: joined, the rule's
 * row lock would be held for the whole account sync and two matching rules taken in
 * data-dependent order would deadlock concurrent same-user syncs.
 */
const pauseRuleOutOfBand = async ({
  ruleId,
  userId,
  missing,
}: {
  ruleId: RecordId;
  userId: number;
  missing: AutomationRef;
}) => {
  logger.warn(`Automation ${ruleId} paused: ${missing.refType} ${missing.refId} no longer exists`, {
    ruleId,
    userId,
    refType: missing.refType,
    refId: missing.refId,
  });
  await TransactionAutomations.update(
    missingReferencePatch({ refType: missing.refType, refId: missing.refId, label: '' }),
    {
      // A delete that committed after this run loaded the rule has already paused it with the row's name.
      where: { id: ruleId, userId, isEnabled: true },
      transaction: null,
    },
  );
};

/**
 * Runs the user's enabled rules top to bottom against one freshly created row; the
 * first rule that applies an action stops the scan. A match whose every action was
 * skipped falls through, and a matched rule pointing at a deleted row is paused instead
 * of applied, so neither starves the rules below it.
 * Returns the re-fetched row when a rule applied, `null` otherwise.
 * Joins the caller's transaction — never catch here, a swallowed `DatabaseError` turns COMMIT into a silent rollback.
 */
export const runTransactionAutomations = withTransaction(
  async ({
    transactionId,
    userId,
    skipSetCategory,
  }: {
    transactionId: RecordId;
    userId: number;
    skipSetCategory: boolean;
  }): Promise<Transactions.default | null> => {
    const rules = await TransactionAutomations.findAll({
      where: { userId, isEnabled: true },
      order: [
        ['position', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    if (!rules.length) return null;

    // Subscription matching stamps the row through its own update, so the instance the
    // caller holds has stale `categorizationMeta`.
    const transaction = await Transactions.default.findByPk(transactionId);
    if (!transaction) return null;

    const ctx = buildAutomationContext({ transaction, userId, resolvers: createLiveResolvers({ userId }) });

    for (const rule of rules) {
      const { matched } = await evaluateConditions({ ctx, conditions: rule.conditions });
      if (!matched) continue;

      // ponytail: refs are re-checked per matched rule; a TransactionAutomationRefs side
      // table with FKs is the upgrade if rule counts ever grow.
      const missing = await findMissingAutomationRef({ userId, conditions: rule.conditions, actions: rule.actions });
      if (missing) {
        await pauseRuleOutOfBand({ ruleId: rule.id, userId, missing });
        continue;
      }

      const applied = await applyActions({ transaction, rule, userId, skipSetCategory });
      if (!applied) continue;

      // ponytail: one autocommit UPDATE per matched row; accumulate per transaction in a
      // WeakMap and flush one aggregated UPDATE in afterCommit if first syncs get heavy.
      await connection.sequelize.query(
        'UPDATE "TransactionAutomations" SET "matchCount" = "matchCount" + 1, "lastMatchedAt" = now() WHERE id = :id',
        { replacements: { id: rule.id }, transaction: null },
      );

      trackAutomationApplied({ userId, ruleId: rule.id, actions: rule.actions, matchCount: rule.matchCount });

      return Transactions.default.findByPk(transactionId);
    }

    return null;
  },
);
