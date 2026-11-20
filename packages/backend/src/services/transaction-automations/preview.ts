import {
  ACCOUNT_TYPES,
  AUTOMATION_LIMITS,
  AUTOMATION_PROTECTED_CATEGORY_SOURCES,
  type AutomationAction,
  type AutomationConditions,
  type AutomationPreviewResult,
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
} from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import AccountGrouping from '@models/accounts-groups/account-grouping.model';
import AccountGroups from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import TransactionAutomations from '@models/transaction-automations.model';
import TransactionTags from '@models/transaction-tags.model';
import { findTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import { type TransactionApiResponse, serializeTransactions } from '@root/serializers';
import { Op, WhereOptions } from 'sequelize';

import { buildNote } from './apply-actions';
import { type AutomationResolvers, buildAutomationContext, resolveGroupAncestry } from './build-context';
import { buildEligibilityWhere } from './eligibility';
import { evaluateConditions } from './evaluate-conditions';
import { validateAutomationRefs } from './references';

// ponytail: account/type items are pushed to SQL under match:'all'; everything else is an
// in-memory scan of the newest eligible rows up to `scanLimit`. Add a date-range prefilter if large histories complain.

/**
 * Under `all` every item must hold, so narrowing on one of them can only drop rows that
 * would fail it anyway. A second item of the same field overwriting the key stays correct.
 * `payee not_in` is left in memory: SQL `NOT IN` drops NULL payees, which the evaluator matches.
 */
const sqlPrefilter = ({ conditions }: { conditions: AutomationConditions }): WhereOptions => {
  const where: Record<string, unknown> = {};
  if (conditions.match !== 'all') return where;

  for (const item of conditions.items) {
    if (item.field === 'account') where.accountId = { [item.operator === 'in' ? Op.in : Op.notIn]: item.value };
    if (item.field === 'payee' && item.operator === 'in') where.payeeId = { [Op.in]: item.value };
    if (item.field === 'transactionType') where.transactionType = item.value;
  }

  return where;
};

/**
 * Evaluates `conditions` against the newest eligible rows. Passing `transactionIds` narrows
 * the scan to those rows, which is also the write-time re-check the apply flow relies on.
 */
export const scanAutomationMatches = async ({
  userId,
  conditions,
  transactionIds,
  scanLimit,
}: {
  userId: number;
  conditions: AutomationConditions;
  transactionIds?: RecordId[];
  scanLimit?: number;
}): Promise<{ rows: Transactions[]; scannedCount: number }> => {
  const accounts = await Accounts.findAll({
    where: { userId },
    attributes: ['id', 'type', 'bankDataProviderConnectionId'],
  });
  const bankAccountIds = accounts.filter((account) => account.type !== ACCOUNT_TYPES.system).map(({ id }) => id);
  const scanned = await findTransactions({
    planned: 'exclude',
    access: { creator: userId },
    balanceAdjustments: 'exclude',
    transfers: { natures: [TRANSACTION_TRANSFER_NATURE.not_transfer] },
    completeness: scanLimit ? { cap: { limit: scanLimit, onTruncated: 'log', context: { userId } } } : 'all',
    order: [
      ['time', 'DESC'],
      ['id', 'DESC'],
    ],
    where: {
      ...buildEligibilityWhere({ bankAccountIds }),
      ...sqlPrefilter({ conditions }),
      paymentParentId: null,
      ...(transactionIds ? { id: { [Op.in]: transactionIds } } : {}),
    },
  });

  if (!scanned.length) return { rows: [], scannedCount: 0 };

  const accountIds = [...new Set(scanned.map((row) => row.accountId))];

  const [groups, memberships] = await Promise.all([
    AccountGroups.findAll({ where: { userId }, attributes: ['id', 'parentGroupId'] }),
    AccountGrouping.findAll({ where: { accountId: accountIds }, attributes: ['accountId', 'groupId'] }),
  ]);

  const groupIdsByAccount = new Map<RecordId, RecordId[]>(
    accountIds.map((accountId) => [
      accountId,
      resolveGroupAncestry({ groups, memberships: memberships.filter((row) => row.accountId === accountId) }),
    ]),
  );
  const connectionByAccount = new Map(
    accounts.map((account) => [account.id, account.bankDataProviderConnectionId ?? null]),
  );

  const resolvers: AutomationResolvers = {
    accountGroupIds: async (accountId) => groupIdsByAccount.get(accountId) ?? [],
    bankConnectionId: async (accountId) => connectionByAccount.get(accountId) ?? null,
  };

  const rows: Transactions[] = [];

  for (const row of scanned) {
    const ctx = buildAutomationContext({ transaction: row, userId, resolvers });
    const { matched } = await evaluateConditions({ ctx, conditions });
    if (matched) rows.push(row);
  }

  return { rows, scannedCount: scanned.length };
};

const isSettled = ({
  row,
  action,
  tagIds,
}: {
  row: Transactions;
  action: AutomationAction;
  tagIds: Set<RecordId>;
}): boolean => {
  const note = row.note ?? '';
  const source = row.categorizationMeta?.source;
  switch (action.type) {
    case 'set_category':
      return (
        row.categoryId === action.categoryId ||
        Boolean(source && AUTOMATION_PROTECTED_CATEGORY_SOURCES.includes(source))
      );
    case 'add_tags':
      return action.tagIds.every((tagId) => tagIds.has(tagId));
    case 'set_payee':
      return row.payeeId === action.payeeId;
    case 'set_note':
      if (action.mode === 'replace')
        return buildNote({ current: note, mode: action.mode, value: action.value }) === note;
      return action.mode === 'append' ? note.endsWith(action.value.trim()) : note.startsWith(action.value.trim());
    default:
      return action satisfies never;
  }
};

/**
 * Drops rows every action would leave unchanged, so the review lists only work left to do.
 * A protected category counts as unchanged because `applyActions` never overwrites it.
 */
const excludeSettledRows = async ({
  rows,
  actions,
}: {
  rows: Transactions[];
  actions: AutomationAction[];
}): Promise<Transactions[]> => {
  const tagIdsByRow = new Map<RecordId, Set<RecordId>>();

  if (actions.some((action) => action.type === 'add_tags') && rows.length) {
    const links = await TransactionTags.findAll({ where: { transactionId: rows.map((row) => row.id) } });
    for (const link of links) {
      tagIdsByRow.set(link.transactionId, (tagIdsByRow.get(link.transactionId) ?? new Set()).add(link.tagId));
    }
  }

  const noTags = new Set<RecordId>();
  return rows.filter(
    (row) => !actions.every((action) => isSettled({ row, action, tagIds: tagIdsByRow.get(row.id) ?? noTags })),
  );
};

/**
 * Dry-runs either an unsaved condition set or a saved rule. The saved-rule path backs the
 * review dialog, so it scans deeper and returns as many matches as the dialog can list.
 */
export const previewAutomation = async ({
  userId,
  conditions,
  automationId,
  limit,
}: {
  userId: number;
  conditions?: AutomationConditions;
  automationId?: RecordId;
  limit?: number;
}): Promise<Omit<AutomationPreviewResult, 'matches'> & { matches: TransactionApiResponse[] }> => {
  const rule = automationId
    ? await findOrThrowNotFound({
        query: TransactionAutomations.findOne({ where: { id: automationId, userId } }),
        message: t({ key: 'automations.automationNotFound' }),
      })
    : null;

  if (rule) await validateAutomationRefs({ userId, conditions: rule.conditions, actions: rule.actions });

  const scannedConditions = rule ? rule.conditions : conditions;

  if (!scannedConditions) {
    throw new ValidationError({ message: t({ key: 'automations.previewRequiresConditions' }) });
  }

  const scan = await scanAutomationMatches({
    userId,
    conditions: scannedConditions,
    scanLimit: rule ? AUTOMATION_LIMITS.applyScanLimit : AUTOMATION_LIMITS.previewScanLimit,
  });
  const rows = rule ? await excludeSettledRows({ rows: scan.rows, actions: rule.actions }) : scan.rows;

  return {
    matchedCount: rows.length,
    settledCount: scan.rows.length - rows.length,
    scannedCount: scan.scannedCount,
    matches: serializeTransactions(rows.slice(0, limit ?? AUTOMATION_LIMITS.previewMatchLimit)),
  };
};
