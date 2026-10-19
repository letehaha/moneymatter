import { toLocalNumber } from '@/js/helpers/formatters';
import {
  type AutomationAction,
  type AutomationAmountCurrency,
  type AutomationCondition,
  type AutomationRefType,
  type RecordId,
  TRANSACTION_TYPES,
  type TransactionAutomationModel,
} from '@bt/shared/types';
import { camelCase } from 'lodash-es';

export type AutomationDensity = 'comfortable' | 'compact';

export type AutomationChipTone = 'income' | 'expense' | 'neutral';

/** Amount suffix: a literal ISO code, or an i18n key for the transaction/base modes. */
export type AutomationChipCurrency = { code: string } | { key: string };

export type AutomationChip =
  | {
      kind: 'amount';
      value: string;
      currency: AutomationChipCurrency;
      tone: AutomationChipTone;
    }
  | { kind: 'transactionType'; labelKey: string; tone: AutomationChipTone }
  | {
      kind: 'text';
      field: 'note' | 'merchant';
      labelKey: string;
      keywords: string[];
    }
  | { kind: 'dayOfMonth'; value: string }
  | { kind: 'ref'; refType: AutomationRefType; id: RecordId; negated: boolean }
  | { kind: 'note'; labelKey: string; value: string };

type AutomationRulePreview = Pick<TransactionAutomationModel, 'conditions' | 'actions'>;

interface AutomationChips {
  when: AutomationChip[];
  match: 'all' | 'any';
  then: AutomationChip[];
}

const formatAmount = ({ value }: { value: number }) =>
  toLocalNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const buildAmountValue = ({ condition }: { condition: Extract<AutomationCondition, { field: 'amount' }> }) => {
  const { min, max } = condition.value;

  if (condition.operator === 'between')
    return `${formatAmount({ value: min ?? 0 })} – ${formatAmount({ value: max ?? 0 })}`;
  if (condition.operator === 'lte') return `≤ ${formatAmount({ value: max ?? min ?? 0 })}`;

  const single = formatAmount({ value: min ?? max ?? 0 });
  return condition.operator === 'gte' ? `≥ ${single}` : `= ${single}`;
};

const buildCurrency = ({ currency }: { currency: AutomationAmountCurrency }): AutomationChipCurrency =>
  currency.mode === 'specific' ? { code: currency.code } : { key: `automations.summary.currency.${currency.mode}` };

const buildConditionChips = ({
  condition,
  tone,
}: {
  condition: AutomationCondition;
  tone: AutomationChipTone;
}): AutomationChip[] => {
  switch (condition.field) {
    case 'note':
    case 'merchant':
      return [
        {
          kind: 'text',
          field: condition.field,
          labelKey: `automations.chips.${condition.field}.${camelCase(condition.operator)}`,
          keywords: condition.operator === 'is_empty' ? [] : condition.value,
        },
      ];
    case 'payee':
    case 'account':
    case 'accountGroup':
    case 'bankConnection':
      return condition.value.map((id) => ({
        kind: 'ref',
        refType: condition.field,
        id,
        negated: condition.operator === 'not_in',
      }));
    case 'amount':
      return [
        {
          kind: 'amount',
          value: buildAmountValue({ condition }),
          currency: buildCurrency({ currency: condition.currency }),
          tone,
        },
      ];
    case 'transactionType':
      return [
        {
          kind: 'transactionType',
          labelKey: `automations.summary.transactionTypeValue.${condition.value}`,
          tone: condition.value === TRANSACTION_TYPES.income ? 'income' : 'expense',
        },
      ];
    case 'dayOfMonth':
      return [
        {
          kind: 'dayOfMonth',
          value: `${condition.value.min} – ${condition.value.max}`,
        },
      ];
  }
};

const NOTE_ACTION_LABEL_KEY: Record<Extract<AutomationAction, { type: 'set_note' }>['mode'], string> = {
  replace: 'automations.chips.noteReplace',
  append: 'automations.chips.noteAppend',
  prepend: 'automations.chips.notePrepend',
};

const buildActionChips = ({ action }: { action: AutomationAction }): AutomationChip[] => {
  switch (action.type) {
    case 'set_category':
      return [
        {
          kind: 'ref',
          refType: 'category',
          id: action.categoryId,
          negated: false,
        },
      ];
    case 'set_payee':
      return [{ kind: 'ref', refType: 'payee', id: action.payeeId, negated: false }];
    case 'add_tags':
      return action.tagIds.map((id) => ({
        kind: 'ref',
        refType: 'tag',
        id,
        negated: false,
      }));
    case 'set_note':
      return [
        {
          kind: 'note',
          labelKey: NOTE_ACTION_LABEL_KEY[action.mode],
          value: action.value,
        },
      ];
  }
};

/** An amount reads as income/expense only when the rule pins the transaction type. */
const resolveTone = ({ rule }: { rule: AutomationRulePreview }): AutomationChipTone => {
  const typeCondition = rule.conditions.items.find((item) => item.field === 'transactionType');
  if (!typeCondition) return 'neutral';

  return typeCondition.value === TRANSACTION_TYPES.income ? 'income' : 'expense';
};

export const buildAutomationChips = ({ rule }: { rule: AutomationRulePreview }): AutomationChips => {
  const tone = resolveTone({ rule });

  return {
    when: rule.conditions.items.flatMap((condition) => buildConditionChips({ condition, tone })),
    match: rule.conditions.match,
    then: rule.actions.flatMap((action) => buildActionChips({ action })),
  };
};
