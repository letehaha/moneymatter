import {
  AUTOMATION_LIMITS,
  type AutomationAmountOperator,
  type AutomationCondition,
  type AutomationRefType,
  type RecordId,
} from '@bt/shared/types';

import type { AutomationActionDraft } from './condition-registry';

/** i18n key plus its interpolation params, so this module stays free of a translator. */
export interface AutomationValidationError {
  key: string;
  params?: Record<string, number>;
}

type AmountCondition = Extract<AutomationCondition, { field: 'amount' }>;

type HasMissingRef = ({ type, ids }: { type: AutomationRefType; ids: RecordId[] }) => boolean;

const error = (key: string, params?: Record<string, number>): AutomationValidationError => ({ key, params });

export const trimKeywords = ({ value }: { value: string[] }) => value.map((keyword) => keyword.trim()).filter(Boolean);

export const nameError = ({ name }: { name: string }): AutomationValidationError | null => {
  const trimmed = name.trim();
  if (!trimmed) return error('automations.editor.errors.nameRequired');
  return trimmed.length > AUTOMATION_LIMITS.maxNameLength
    ? error('automations.editor.errors.nameTooLong', { max: AUTOMATION_LIMITS.maxNameLength })
    : null;
};

export const conditionError = ({
  items,
  index,
  hasMissingRef = () => false,
}: {
  items: AutomationCondition[];
  index: number;
  hasMissingRef?: HasMissingRef;
}): AutomationValidationError | null => {
  const condition = items[index];
  if (!condition) return null;

  switch (condition.field) {
    case 'note':
    case 'merchant': {
      if (condition.operator === 'is_empty') return null;
      const keywords = trimKeywords({ value: condition.value });
      if (!keywords.length) return error('automations.editor.errors.keywordsRequired');
      if (keywords.length > AUTOMATION_LIMITS.maxKeywords)
        return error('automations.editor.errors.keywordsMax', { max: AUTOMATION_LIMITS.maxKeywords });
      if (keywords.some((keyword) => keyword.length > AUTOMATION_LIMITS.maxKeywordLength))
        return error('automations.editor.errors.keywordTooLong', { max: AUTOMATION_LIMITS.maxKeywordLength });
      return null;
    }
    case 'payee':
    case 'account':
    case 'accountGroup':
    case 'bankConnection': {
      if (!condition.value.length) return error('automations.editor.errors.selectionRequired');
      if (condition.value.length > AUTOMATION_LIMITS.maxIds)
        return error('automations.editor.errors.selectionMax', { max: AUTOMATION_LIMITS.maxIds });
      if (hasMissingRef({ type: condition.field, ids: condition.value }))
        return error('automations.editor.errors.missingRef');
      return null;
    }
    case 'amount': {
      const { min, max } = condition.value;
      if (condition.operator === 'between') {
        if (min == null || max == null) return error('automations.editor.errors.amountBoundsRequired');
        return min > max ? error('automations.editor.errors.amountRange') : null;
      }
      const bound = condition.operator === 'lte' ? max : min;
      return bound == null ? error('automations.editor.errors.amountRequired') : null;
    }
    case 'dayOfMonth': {
      const { min, max } = condition.value;
      const isDay = (value: number) => Number.isInteger(value) && value >= 1 && value <= 31;
      return isDay(min) && isDay(max) && min <= max ? null : error('automations.editor.errors.dayRange');
    }
    case 'transactionType':
      return items.findIndex((item) => item.field === 'transactionType') === index
        ? null
        : error('automations.editor.errors.transactionTypeDuplicate');
  }
};

export const actionError = ({
  action,
  hasMissingRef = () => false,
}: {
  action: AutomationActionDraft;
  hasMissingRef?: HasMissingRef;
}): AutomationValidationError | null => {
  switch (action.type) {
    case 'set_category':
      if (!action.categoryId) return error('automations.editor.errors.categoryRequired');
      return hasMissingRef({ type: 'category', ids: [action.categoryId] })
        ? error('automations.editor.errors.missingRef')
        : null;
    case 'set_payee':
      if (!action.payeeId) return error('automations.editor.errors.payeeRequired');
      return hasMissingRef({ type: 'payee', ids: [action.payeeId] })
        ? error('automations.editor.errors.missingRef')
        : null;
    case 'add_tags':
      if (!action.tagIds.length) return error('automations.editor.errors.tagsRequired');
      if (action.tagIds.length > AUTOMATION_LIMITS.maxIds)
        return error('automations.editor.errors.selectionMax', { max: AUTOMATION_LIMITS.maxIds });
      return hasMissingRef({ type: 'tag', ids: action.tagIds }) ? error('automations.editor.errors.missingRef') : null;
    case 'set_note': {
      const value = action.value.trim();
      if (!value) return error('automations.editor.errors.noteRequired');
      return value.length > AUTOMATION_LIMITS.maxNoteLength
        ? error('automations.editor.errors.noteTooLong', { max: AUTOMATION_LIMITS.maxNoteLength })
        : null;
    }
    case 'exclude_from_stats':
      return null;
  }
};

/**
 * Amount keeps a single bound under gte/lte/equals and two under between, so switching
 * operator has to move the number into the slot the backend reads.
 */
export const migrateAmountBounds = ({
  condition,
  operator,
}: {
  condition: AmountCondition;
  operator: AutomationAmountOperator;
}): AmountCondition['value'] => {
  const { min, max } = condition.value;
  if (operator === 'between') return { min: min ?? max, max: max ?? min };
  if (operator === 'lte') return { max: max ?? min };
  return { min: min ?? max };
};
