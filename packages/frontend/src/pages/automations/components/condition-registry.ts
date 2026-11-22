import {
  AUTOMATION_AMOUNT_OPERATORS,
  AUTOMATION_LIST_OPERATORS,
  AUTOMATION_TEXT_OPERATORS,
  type AutomationAction,
  type AutomationActionType,
  type AutomationCondition,
  type AutomationConditionField,
  type RecordId,
  TRANSACTION_TYPES,
} from '@bt/shared/types';

export const CONDITION_REGISTRY: Record<
  AutomationConditionField,
  { operators: readonly string[]; defaultValue: () => AutomationCondition }
> = {
  note: {
    operators: AUTOMATION_TEXT_OPERATORS,
    defaultValue: () => ({ field: 'note', operator: 'contains_any', value: [] }),
  },
  merchant: {
    operators: AUTOMATION_TEXT_OPERATORS,
    defaultValue: () => ({ field: 'merchant', operator: 'contains_any', value: [] }),
  },
  payee: {
    operators: AUTOMATION_LIST_OPERATORS,
    defaultValue: () => ({ field: 'payee', operator: 'in', value: [] }),
  },
  amount: {
    operators: AUTOMATION_AMOUNT_OPERATORS,
    defaultValue: () => ({ field: 'amount', operator: 'gte', value: {}, currency: { mode: 'transaction' } }),
  },
  transactionType: {
    operators: ['equals'],
    defaultValue: () => ({ field: 'transactionType', operator: 'equals', value: TRANSACTION_TYPES.expense }),
  },
  account: {
    operators: AUTOMATION_LIST_OPERATORS,
    defaultValue: () => ({ field: 'account', operator: 'in', value: [] }),
  },
  accountGroup: {
    operators: AUTOMATION_LIST_OPERATORS,
    defaultValue: () => ({ field: 'accountGroup', operator: 'in', value: [] }),
  },
  bankConnection: {
    operators: AUTOMATION_LIST_OPERATORS,
    defaultValue: () => ({ field: 'bankConnection', operator: 'in', value: [] }),
  },
  dayOfMonth: {
    operators: ['between'],
    defaultValue: () => ({ field: 'dayOfMonth', operator: 'between', value: { min: 1, max: 31 } }),
  },
};

export const CONDITION_FIELDS = Object.keys(CONDITION_REGISTRY) as AutomationConditionField[];

/** `set_category` and `set_payee` start empty in the editor; validation blocks saving them that way. */
export type AutomationActionDraft =
  | { type: 'set_category'; categoryId: RecordId | null }
  | { type: 'set_payee'; payeeId: RecordId | null }
  | Extract<AutomationAction, { type: 'add_tags' } | { type: 'set_note' } | { type: 'exclude_from_stats' }>;

export const ACTION_DEFAULTS: Record<AutomationActionType, () => AutomationActionDraft> = {
  set_category: () => ({ type: 'set_category', categoryId: null }),
  set_payee: () => ({ type: 'set_payee', payeeId: null }),
  add_tags: () => ({ type: 'add_tags', tagIds: [] }),
  set_note: () => ({ type: 'set_note', mode: 'replace', value: '' }),
  exclude_from_stats: () => ({ type: 'exclude_from_stats' }),
};

export const ACTION_TYPES = Object.keys(ACTION_DEFAULTS) as AutomationActionType[];
