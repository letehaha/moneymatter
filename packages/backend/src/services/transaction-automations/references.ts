import type {
  AutomationAction,
  AutomationConditionField,
  AutomationConditions,
  AutomationRefType,
  RecordId,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import Tags from '@models/tags.model';
import TransactionAutomations from '@models/transaction-automations.model';
import { withTransaction } from '@services/common/with-transaction';
import { Model, Op, type ModelStatic } from 'sequelize';

const CONDITION_REF_TYPE: Record<AutomationConditionField, AutomationRefType | null> = {
  account: 'account',
  accountGroup: 'accountGroup',
  bankConnection: 'bankConnection',
  payee: 'payee',
  note: null,
  merchant: null,
  amount: null,
  transactionType: null,
  dayOfMonth: null,
};

const REF_MODELS: Record<AutomationRefType, ModelStatic<Model>> = {
  category: Categories,
  tag: Tags,
  account: Accounts,
  accountGroup: AccountGroup,
  bankConnection: BankDataProviderConnections,
  payee: Payees,
};

export interface AutomationRef {
  refType: AutomationRefType;
  refId: RecordId;
  /** Points the editor at the offending row, e.g. `conditions.items[2]`. */
  path: string;
}

interface AutomationBody {
  conditions: AutomationConditions;
  actions: AutomationAction[];
}

/** Currency codes the amount conditions name (`currency.mode === 'specific'`). */
export const collectAutomationCurrencyCodes = ({ conditions }: { conditions: AutomationConditions }): string[] =>
  conditions.items.flatMap((item) =>
    item.field === 'amount' && item.currency.mode === 'specific' ? [item.currency.code] : [],
  );

export const collectAutomationRefs = ({ conditions, actions }: AutomationBody): AutomationRef[] => {
  const refs: AutomationRef[] = [];

  conditions.items.forEach((item, index) => {
    const refType = CONDITION_REF_TYPE[item.field];
    if (!refType) return;
    for (const refId of item.value as RecordId[]) {
      refs.push({ refType, refId, path: `conditions.items[${index}]` });
    }
  });

  actions.forEach((action, index) => {
    const path = `actions[${index}]`;
    switch (action.type) {
      case 'set_category':
        refs.push({ refType: 'category', refId: action.categoryId, path });
        break;
      case 'add_tags':
        for (const refId of action.tagIds) refs.push({ refType: 'tag', refId, path });
        break;
      case 'set_payee':
        refs.push({ refType: 'payee', refId: action.payeeId, path });
        break;
      case 'set_note':
      case 'exclude_from_stats':
        break;
      default:
        action satisfies never;
    }
  });

  return refs;
};

/** First id inside the rule that no longer belongs to the user, `null` when every reference resolves. */
export const findMissingAutomationRef = async ({
  userId,
  conditions,
  actions,
}: AutomationBody & { userId: number }): Promise<AutomationRef | null> => {
  const refs = collectAutomationRefs({ conditions, actions });
  if (!refs.length) return null;

  const byType = new Map<AutomationRefType, RecordId[]>();
  for (const ref of refs) {
    const ids = byType.get(ref.refType) ?? [];
    ids.push(ref.refId);
    byType.set(ref.refType, ids);
  }

  for (const [refType, ids] of byType) {
    const rows = await REF_MODELS[refType].findAll({
      where: { userId, id: { [Op.in]: ids } },
      attributes: ['id'],
    });
    const found = new Set(rows.map((row) => row.get('id') as RecordId));
    const missing = refs.find((ref) => ref.refType === refType && !found.has(ref.refId));

    if (missing) return missing;
  }

  return null;
};

/**
 * Every id inside a rule must belong to the caller. Throws 422 (not 404) — the
 * id is one field inside a rule body, not the request's subject, and the editor
 * highlights the row named by `details.path`.
 */
export const validateAutomationRefs = async ({ userId, conditions, actions }: AutomationBody & { userId: number }) => {
  const missing = await findMissingAutomationRef({ userId, conditions, actions });

  if (missing) {
    throw new ValidationError({
      message: t({ key: 'automations.staleReference' }),
      details: { path: missing.path, refType: missing.refType, refId: missing.refId },
    });
  }
};

export const missingReferencePatch = ({
  refType,
  refId,
  label,
}: {
  refType: AutomationRefType;
  refId: RecordId;
  label: string;
}) => ({
  isEnabled: false,
  pausedReason: { kind: 'missing_reference' as const, refType, refId, label, at: new Date().toISOString() },
});

export const pauseAutomationsReferencing = withTransaction(
  async ({
    userId,
    refType,
    refId,
    label,
  }: {
    userId: number;
    refType: AutomationRefType;
    refId: RecordId;
    label: string;
  }) => {
    const automations = await TransactionAutomations.findAll({ where: { userId } });
    const ids = automations
      .filter((automation) =>
        collectAutomationRefs(automation).some((ref) => ref.refType === refType && ref.refId === refId),
      )
      .map((automation) => automation.id);

    if (!ids.length) return;

    await TransactionAutomations.update(missingReferencePatch({ refType, refId, label }), {
      where: { id: { [Op.in]: ids }, userId },
    });
  },
);

/** Repoint every reference to `from` at `to` when a delete names a successor (category replacement, payee merge). */
export const rewriteAutomationRef = withTransaction(
  async ({
    userId,
    refType,
    from,
    to,
  }: {
    userId: number;
    refType: 'category' | 'payee';
    from: RecordId;
    to: RecordId;
  }) => {
    const swap = (ids: RecordId[]) => [...new Set(ids.map((id) => (id === from ? to : id)))];
    const automations = await TransactionAutomations.findAll({ where: { userId } });

    for (const automation of automations) {
      let changed = false;
      const conditions = structuredClone(automation.conditions);
      const actions = structuredClone(automation.actions);

      for (const item of conditions.items) {
        if (CONDITION_REF_TYPE[item.field] !== refType) continue;
        const value = item.value as RecordId[];
        if (!value.includes(from)) continue;
        (item as { value: RecordId[] }).value = swap(value);
        changed = true;
      }

      for (const action of actions) {
        if (refType === 'category' && action.type === 'set_category' && action.categoryId === from) {
          action.categoryId = to;
          changed = true;
        }
        if (refType === 'payee' && action.type === 'set_payee' && action.payeeId === from) {
          action.payeeId = to;
          changed = true;
        }
      }

      if (changed) await automation.update({ conditions, actions });
    }
  },
);
